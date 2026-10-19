from __future__ import annotations

import wave
from pathlib import Path

import numpy as np

from transcript_studio.services.live_segmenter import SAMPLE_RATE


class WavRecorder:
    """Appends a live 16 kHz mono stream to a WAV file as it arrives (nothing is lost if the tab closes)."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._file = wave.open(str(path), "wb")
        self._file.setnchannels(1)
        self._file.setsampwidth(2)
        self._file.setframerate(SAMPLE_RATE)
        self._closed = False

    def write(self, samples: np.ndarray) -> None:
        if not self._closed:
            self._file.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self._file.close()  # also fixes the header sizes
