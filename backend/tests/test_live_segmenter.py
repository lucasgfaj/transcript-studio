from __future__ import annotations

import numpy as np

from transcript_studio.services.live_segmenter import SAMPLE_RATE, LiveSegmenter, pcm16_to_float


def tone(seconds: float, amplitude: float = 0.2) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def feed(segmenter: LiveSegmenter, audio: np.ndarray, block: float = 0.25) -> list:
    size = int(block * SAMPLE_RATE)
    out = []
    for i in range(0, len(audio), size):
        out.extend(segmenter.push(audio[i:i + size]))
    return out


def test_cuts_at_pauses_and_keeps_timestamps() -> None:
    segmenter = LiveSegmenter()
    audio = np.concatenate([tone(3), silence(1), tone(2.5), silence(1)])
    utterances = feed(segmenter, audio) + segmenter.flush()
    assert len(utterances) == 2
    assert utterances[0].start == 0 and 3.0 <= utterances[0].end <= 3.8
    assert 3.2 <= utterances[1].start <= 4.0 and utterances[1].end >= 6.4


def test_does_not_cut_before_minimum_length() -> None:
    segmenter = LiveSegmenter(min_seconds=2.0)
    utterances = feed(segmenter, np.concatenate([tone(0.5), silence(0.8), tone(0.8), silence(1)]))
    assert len(utterances) == 1  # the short pause inside the first 2 s was ignored
    assert utterances[0].start == 0


def test_forces_a_cut_when_nobody_pauses() -> None:
    segmenter = LiveSegmenter(max_seconds=15.0)
    utterances = feed(segmenter, tone(40))
    assert len(utterances) >= 2
    assert all(len(u.samples) <= 15 * SAMPLE_RATE for u in utterances)
    assert utterances[1].start == utterances[0].end


def test_silence_is_dropped_but_time_keeps_running() -> None:
    segmenter = LiveSegmenter()
    utterances = feed(segmenter, np.concatenate([silence(5), tone(3), silence(1)])) + segmenter.flush()
    assert len(utterances) == 1
    assert 4.5 <= utterances[0].start <= 5.0


def test_pcm16_conversion() -> None:
    data = np.array([0, 16384, -32768], dtype="<i2").tobytes()
    assert pcm16_to_float(data).tolist() == [0.0, 0.5, -1.0]
