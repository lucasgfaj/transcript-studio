"""FasterWhisperTranscriber with fake faster_whisper/ctranslate2 modules (no GPU or model download)."""
from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from transcript_studio.domain.ports import TranscriptionCancelled
from transcript_studio.infrastructure import whisper
from transcript_studio.infrastructure.whisper import FasterWhisperTranscriber


class Engine:
    """Stands in for faster_whisper: records how models are built and how they are called."""

    def __init__(self) -> None:
        self.cuda_devices = 1
        self.fail_on_cuda = False
        self.models: list[dict[str, Any]] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.segments = [(0.0, 2.0, " Bom dia. "), (2.0, 3.0, "   "), (3.0, 5.5, "Vamos começar.")]

    def result(self) -> tuple[Any, Any]:
        segments = (SimpleNamespace(start=s, end=e, text=t) for s, e, t in self.segments)
        return segments, SimpleNamespace(duration=5.5, language="pt")


@pytest.fixture
def engine(monkeypatch: pytest.MonkeyPatch) -> Engine:
    fake = Engine()

    class WhisperModel:
        def __init__(self, name: str, device: str, compute_type: str, cpu_threads: int) -> None:
            if device == "cuda" and fake.fail_on_cuda:
                raise RuntimeError("CUDA failed")
            fake.models.append({"name": name, "device": device, "compute_type": compute_type})

        def transcribe(self, audio: Any, **options: Any) -> tuple[Any, Any]:
            fake.calls.append(("sequential", {"audio": audio, **options}))
            return fake.result()

    class BatchedInferencePipeline:
        def __init__(self, model: WhisperModel) -> None:
            self.model = model

        def transcribe(self, audio: Any, **options: Any) -> tuple[Any, Any]:
            fake.calls.append(("batched", {"audio": audio, **options}))
            return fake.result()

    faster_whisper = types.ModuleType("faster_whisper")
    faster_whisper.WhisperModel = WhisperModel  # type: ignore[attr-defined]
    faster_whisper.BatchedInferencePipeline = BatchedInferencePipeline  # type: ignore[attr-defined]
    ctranslate2 = types.ModuleType("ctranslate2")
    ctranslate2.get_cuda_device_count = lambda: fake.cuda_devices  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "faster_whisper", faster_whisper)
    monkeypatch.setitem(sys.modules, "ctranslate2", ctranslate2)
    monkeypatch.setattr(whisper, "_preload_pip_cuda_libraries", lambda: None)
    return fake


def use_duration(monkeypatch: pytest.MonkeyPatch, seconds: float) -> None:
    monkeypatch.setattr(whisper, "_duration", lambda audio: seconds)


def test_loads_once_on_the_gpu_and_skips_empty_text(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    use_duration(monkeypatch, 10)
    transcriber = FasterWhisperTranscriber("small")
    seen: list[tuple[str, float]] = []

    result = transcriber.transcribe(Path("a.wav"), on_segment=lambda segment, total: seen.append((segment.text, total)))
    transcriber.transcribe(Path("a.wav"))

    assert engine.models == [{"name": "small", "device": "cuda", "compute_type": "int8_float16"}]
    assert transcriber.device == "cuda"
    assert [(s.start, s.end, s.text) for s in result.segments] == [(0.0, 2.0, "Bom dia."), (3.0, 5.5, "Vamos começar.")]
    assert result.duration == 5.5 and result.language == "pt"
    assert seen == [("Bom dia.", 5.5), ("Vamos começar.", 5.5)]


def test_falls_back_to_cpu_when_cuda_fails(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    use_duration(monkeypatch, 10)
    engine.fail_on_cuda = True
    transcriber = FasterWhisperTranscriber()

    transcriber.warm_up()

    assert engine.models[-1]["device"] == "cpu" and engine.models[-1]["compute_type"] == "int8"
    assert transcriber.device == "cpu"


def test_uses_cpu_without_a_gpu(engine: Engine) -> None:
    engine.cuda_devices = 0
    FasterWhisperTranscriber().warm_up()
    assert engine.models == [{"name": "large-v3-turbo", "device": "cpu", "compute_type": "int8"}]


@pytest.mark.parametrize(("mode", "seconds", "expected"), [
    ("fast", 600, "batched"),        # long file: batched pipeline
    ("fast", 30, "sequential"),      # short file: batching gains nothing
    ("detailed", 600, "sequential"),  # sentence timestamps
])
def test_picks_batched_or_sequential(engine: Engine, monkeypatch: pytest.MonkeyPatch, mode: str, seconds: float,
                                     expected: str) -> None:
    use_duration(monkeypatch, seconds)
    FasterWhisperTranscriber(batch_size=8).transcribe(Path("a.wav"), language="pt", mode=mode)  # type: ignore[arg-type]

    kind, options = engine.calls[-1]
    assert kind == expected
    assert options["language"] == "pt" and options["condition_on_previous_text"] is False
    assert options.get("batch_size") == (8 if expected == "batched" else None)
    assert options.get("vad_filter") is (None if expected == "batched" else True)


def test_without_batching_always_sequential(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    use_duration(monkeypatch, 600)
    FasterWhisperTranscriber(batch_size=1).transcribe(Path("a.wav"))
    assert engine.calls[-1][0] == "sequential"


def test_stop_cancels_while_decoding(engine: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    use_duration(monkeypatch, 10)
    with pytest.raises(TranscriptionCancelled):
        FasterWhisperTranscriber().transcribe(Path("a.wav"), should_stop=lambda: True)


def test_live_samples_are_offset_and_use_the_previous_text(engine: Engine) -> None:
    found = FasterWhisperTranscriber().transcribe_samples([0.0] * 10, language="pt", offset=60.0, prompt="antes")

    assert [(s.start, s.end, s.text) for s in found] == [(60.0, 62.0, "Bom dia."), (63.0, 65.5, "Vamos começar.")]
    options = engine.calls[-1][1]
    assert options["initial_prompt"] == "antes" and options["vad_filter"] is True


def test_switching_model_reloads_and_unload_frees(engine: Engine) -> None:
    transcriber = FasterWhisperTranscriber("small")
    transcriber.warm_up()
    transcriber.set_model("small")  # same model: nothing to do
    transcriber.set_model("medium")
    transcriber.warm_up()
    transcriber.unload()
    transcriber.unload()  # already unloaded: no error
    transcriber.warm_up()

    assert transcriber.model_name == "medium"
    assert [m["name"] for m in engine.models] == ["small", "medium", "medium"]


def test_unreadable_audio_counts_as_zero_seconds(tmp_path: Path) -> None:
    broken = tmp_path / "x.wav"
    broken.write_bytes(b"nope")
    assert whisper._duration(broken) == 0.0


def test_unknown_model_is_not_downloaded() -> None:
    assert whisper.is_downloaded("modelo-que-nao-existe") is False
