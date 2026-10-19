"""Cuts a live 16 kHz mono stream into utterances at natural pauses, so each Whisper call gets whole sentences.

Cutting on fixed time blocks splits words in half; waiting for a pause gives better text and,
because speech has frequent short pauses, still shows text a couple of seconds after it is said.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
_FRAME = SAMPLE_RATE * 30 // 1000  # 30 ms energy frames


@dataclass(frozen=True)
class Utterance:
    start: float           # seconds from the beginning of the recording
    samples: np.ndarray    # float32, 16 kHz mono

    @property
    def end(self) -> float:
        return self.start + len(self.samples) / SAMPLE_RATE


class LiveSegmenter:
    def __init__(self, min_seconds: float = 2.0, max_seconds: float = 15.0, pause_seconds: float = 0.6,
                 silence_rms: float = 0.012) -> None:
        self._min = int(min_seconds * SAMPLE_RATE)
        self._max = int(max_seconds * SAMPLE_RATE)
        self._pause_frames = max(1, int(pause_seconds * SAMPLE_RATE / _FRAME))
        self._silence_rms = silence_rms
        self._buffer = np.zeros(0, dtype=np.float32)
        self._offset = 0  # samples already emitted or dropped
        self.total_samples = 0

    def push(self, samples: np.ndarray) -> list[Utterance]:
        """Adds audio and returns the utterances that are complete."""
        self._buffer = np.concatenate([self._buffer, samples.astype(np.float32, copy=False)])
        self.total_samples += len(samples)
        ready: list[Utterance] = []
        while (cut := self._find_cut()) is not None:
            ready.extend(self._take(cut))
        return ready

    def flush(self) -> list[Utterance]:
        """Whatever is left when recording stops."""
        return self._take(len(self._buffer)) if len(self._buffer) else []

    def _find_cut(self) -> int | None:
        if len(self._buffer) < self._min:
            return None
        quiet = self._quiet_frames(self._buffer)
        # First pause long enough after the minimum length: cut in its middle.
        run = 0
        for index in range(self._min // _FRAME, len(quiet)):
            run = run + 1 if quiet[index] else 0
            if run >= self._pause_frames:
                return (index - run // 2) * _FRAME
        if len(self._buffer) >= self._max:
            # Nobody paused: cut at the quietest 100 ms of the last 3 s.
            window = SAMPLE_RATE // 10
            tail_start = self._max - 3 * SAMPLE_RATE
            tail = self._buffer[tail_start:self._max] ** 2
            energy = np.convolve(tail, np.ones(window), mode="valid")
            return tail_start + int(np.argmin(energy)) + window // 2
        return None

    def _take(self, cut: int) -> list[Utterance]:
        piece, self._buffer = self._buffer[:cut], self._buffer[cut:]
        start = self._offset / SAMPLE_RATE
        self._offset += cut
        if not len(piece) or self._quiet_frames(piece).all():
            return []  # silence: nothing to transcribe (and no Whisper hallucinations on it)
        return [Utterance(start, piece)]

    def _quiet_frames(self, audio: np.ndarray) -> np.ndarray:
        usable = len(audio) - len(audio) % _FRAME
        if usable == 0:
            return np.ones(1, dtype=bool)
        frames = audio[:usable].reshape(-1, _FRAME)
        return np.sqrt((frames ** 2).mean(axis=1)) < self._silence_rms


def pcm16_to_float(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768.0
