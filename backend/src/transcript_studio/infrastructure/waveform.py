"""Precomputed waveform peaks, so the browser can draw long audio without decoding it."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from transcript_studio.domain.errors import InvalidAudioError

_RATE = 8_000  # plenty for an overview of speech


class CachedWaveform:
    def __init__(self, buckets: int = 1_600) -> None:
        self._buckets = buckets

    def peaks(self, audio: Path) -> list[float]:
        stat = audio.stat()
        cache = audio.with_name(f".{audio.name}.peaks.json")
        key = f"{stat.st_size}:{stat.st_mtime_ns}:{self._buckets}"
        if cache.exists():
            cached = json.loads(cache.read_text())
            if cached.get("key") == key:
                return cached["peaks"]
        peaks = self._compute(audio)
        cache.write_text(json.dumps({"key": key, "peaks": peaks}))
        return peaks

    def _compute(self, audio: Path) -> list[float]:
        import av

        chunks: list[np.ndarray] = []
        try:
            with av.open(str(audio), metadata_errors="ignore") as container:
                resampler = av.AudioResampler(format="s16", layout="mono", rate=_RATE)
                for frame in container.decode(audio=0):
                    for resampled in resampler.resample(frame):
                        chunks.append(resampled.to_ndarray().reshape(-1))
        except Exception as error:
            raise InvalidAudioError(f"Não consegui ler o áudio: {error}") from error
        if not chunks:
            return []
        samples = np.abs(np.concatenate(chunks).astype(np.float32)) / 32768.0
        buckets = min(self._buckets, len(samples))
        usable = len(samples) - len(samples) % buckets
        peaks = samples[:usable].reshape(buckets, -1).max(axis=1)
        top = float(peaks.max()) or 1.0
        return [round(float(value) / top, 3) for value in peaks]
