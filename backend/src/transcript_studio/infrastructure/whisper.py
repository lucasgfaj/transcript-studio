"""faster-whisper adapter (GPU when available). Ported from transcript-mk, plus batched mode and timestamps."""
from __future__ import annotations

import ctypes
import gc
import glob
import os
import sys
import threading
from pathlib import Path
from typing import Any

from transcript_studio.domain.ports import (
    OnSegment, ShouldStop, TranscribedSegment, TranscriptionCancelled, TranscriptionMode, TranscriptionResult,
)

# Short files gain nothing from batching and pay its VAD/setup cost.
_BATCH_MIN_SECONDS = 90

# Long files go to Whisper in windows. The sequential mode computes the spectrogram of the whole
# audio at once: 3.5 h needed more than 7 GB and the WSL killed the process (OOM). With 15-minute
# windows memory stays at about the size of the decoded audio, and cancelling answers between windows.
_SAMPLE_RATE = 16_000
_WINDOW_SECONDS = 15 * 60
_CUT_SEARCH_SECONDS = 20  # each window ends at the quietest moment of its last 20 s, not mid-word
_CUT_FRAME = _SAMPLE_RATE // 10


def _preload_pip_cuda_libraries() -> None:
    """ctranslate2 needs cuBLAS/cuDNN; load the pip-installed copies so LD_LIBRARY_PATH is not required."""
    if not sys.platform.startswith("linux"):
        return
    for site in sys.path:
        nvidia = Path(site) / "nvidia"
        if not nvidia.is_dir():
            continue
        for pattern in ("libcublasLt.so.*[0-9]", "libcublas.so.*[0-9]", "libcudnn*.so.*[0-9]"):
            for library in sorted(glob.glob(str(nvidia / "*" / "lib" / pattern))):
                try:
                    ctypes.CDLL(library, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


class FasterWhisperTranscriber:
    """Keeps the model loaded between jobs (loading costs ~7 s); `unload()` frees the GPU for the LLM."""

    def __init__(self, model: str = "large-v3-turbo", device: str = "auto", compute_type: str = "auto",
                 batch_size: int = 16) -> None:
        self._model_name = model
        self._device = device
        self._compute_type = compute_type
        self._batch_size = batch_size
        self._model: Any = None
        self._batched: Any = None
        self._lock = threading.Lock()
        self.device: str | None = None

    def transcribe(self, audio: Path, language: str | None = "pt", mode: TranscriptionMode = "fast",
                   on_segment: OnSegment | None = None, should_stop: ShouldStop | None = None) -> TranscriptionResult:
        with self._lock:
            model, batched = self._load()
            options: dict[str, Any] = {
                "language": language or None,
                "beam_size": 5,
                "condition_on_previous_text": False,
            }
            duration = _duration(audio)
            # Measured on an RTX 4050: 32 min in 26 s (75x) vs 59 s sequential, same text;
            # segments follow the VAD chunks (up to ~30 s) instead of sentences.
            use_batched = mode == "fast" and batched is not None and duration >= _BATCH_MIN_SECONDS

            def run(source: Any) -> tuple[Any, Any]:
                if use_batched:
                    return batched.transcribe(source, batch_size=self._batch_size, **options)
                return model.transcribe(source, vad_filter=True, **options)

            if duration <= _WINDOW_SECONDS + _CUT_SEARCH_SECONDS:
                segments, info = run(str(audio))
                total = float(info.duration)
                collected = _collect(segments, 0.0, total, on_segment, should_stop)
                return TranscriptionResult(segments=collected, duration=total, language=info.language)

            samples = _decode(audio)
            total = len(samples) / _SAMPLE_RATE
            collected = []
            language = options["language"]
            try:
                for start, end in _windows(samples):
                    if should_stop and should_stop():
                        raise TranscriptionCancelled()
                    segments, info = run(samples[start:end])
                    if options["language"] is None:  # detect once, then keep it for the next windows
                        options["language"] = language = info.language
                    collected += _collect(segments, start / _SAMPLE_RATE, total, on_segment, should_stop)
            finally:
                del samples
                gc.collect()
            return TranscriptionResult(segments=collected, duration=total, language=language)

    def transcribe_samples(self, samples: Any, language: str | None = "pt", offset: float = 0.0,
                           prompt: str | None = None) -> list[TranscribedSegment]:
        with self._lock:
            model, _batched = self._load()
            segments, _info = model.transcribe(
                samples, language=language or None, beam_size=5, vad_filter=True,
                condition_on_previous_text=False, initial_prompt=prompt or None,
            )
            return [TranscribedSegment(offset + float(s.start), offset + float(s.end), s.text.strip())
                    for s in segments if s.text.strip()]

    @property
    def model_name(self) -> str:
        return self._model_name

    def set_model(self, name: str) -> None:
        """Switches the Whisper size; the old model leaves the GPU and the new one loads on next use."""
        with self._lock:
            if name != self._model_name:
                self._model = self._batched = None
                gc.collect()
                self._model_name = name

    def warm_up(self) -> None:
        """Loads the model ahead of time: a cold first load took ~30 s, a warm job on 3 min of audio ~4 s."""
        with self._lock:
            self._load()

    def unload(self) -> None:
        with self._lock:
            if self._model is not None:
                self._model = self._batched = None
                gc.collect()

    def _load(self) -> tuple[Any, Any]:
        if self._model is not None:
            return self._model, self._batched
        _preload_pip_cuda_libraries()
        import ctranslate2
        from faster_whisper import BatchedInferencePipeline, WhisperModel

        device = self._device
        if device == "auto":
            device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
        compute_type = self._compute_type
        if compute_type == "auto":
            compute_type = "int8_float16" if device == "cuda" else "int8"
        try:
            model = WhisperModel(self._model_name, device=device, compute_type=compute_type,
                                 cpu_threads=os.cpu_count() or 4)
        except (RuntimeError, ValueError):
            if device != "cuda":
                raise
            device, compute_type = "cpu", "int8"
            model = WhisperModel(self._model_name, device=device, compute_type=compute_type,
                                 cpu_threads=os.cpu_count() or 4)
        self._model = model
        self._batched = BatchedInferencePipeline(model=model) if self._batch_size > 1 else None
        self.device = device
        return self._model, self._batched


def is_downloaded(name: str) -> bool:
    """Whether the model files are already in the Hugging Face cache (otherwise the first use downloads them)."""
    try:
        from faster_whisper.utils import _MODELS
        from huggingface_hub import try_to_load_from_cache

        return isinstance(try_to_load_from_cache(_MODELS.get(name, name), "model.bin"), str)
    except Exception:
        return False


def _collect(segments: Any, offset: float, total: float, on_segment: OnSegment | None,
             should_stop: ShouldStop | None) -> list[TranscribedSegment]:
    collected: list[TranscribedSegment] = []
    for segment in segments:  # lazy generator: decoding happens while iterating
        if should_stop and should_stop():
            raise TranscriptionCancelled()
        text = segment.text.strip()
        if not text:
            continue
        item = TranscribedSegment(start=offset + float(segment.start), end=offset + float(segment.end), text=text)
        collected.append(item)
        if on_segment:
            on_segment(item, total)
    return collected


def _windows(samples: Any) -> list[tuple[int, int]]:
    """Sample ranges of about _WINDOW_SECONDS each, cut at the quietest 0.1 s near the end of each one."""
    import numpy as np

    size, search, count = _WINDOW_SECONDS * _SAMPLE_RATE, _CUT_SEARCH_SECONDS * _SAMPLE_RATE, len(samples)
    ranges: list[tuple[int, int]] = []
    start = 0
    while start < count:
        end = start + size
        if end + search >= count:
            ranges.append((start, count))
            break
        low = end - search
        frames = samples[low:end].reshape(-1, _CUT_FRAME)
        quietest = int(np.argmin(np.mean(np.square(frames, dtype=np.float32), axis=1)))
        cut = low + quietest * _CUT_FRAME + _CUT_FRAME // 2
        ranges.append((start, cut))
        start = cut
    return ranges


def _decode(audio: Path) -> Any:
    from faster_whisper.audio import decode_audio

    return decode_audio(str(audio), sampling_rate=_SAMPLE_RATE)


def _duration(audio: Path) -> float:
    from transcript_studio.infrastructure.audio_storage import probe_duration

    try:
        return probe_duration(audio)
    except Exception:
        return 0.0
