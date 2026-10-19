from __future__ import annotations

import io
import math
import struct
import threading
import wave
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from transcript_studio.core.config import Settings
from transcript_studio.domain.ports import (
    OnSegment, ShouldStop, TranscribedSegment, TranscriptionCancelled, TranscriptionMode, TranscriptionResult,
)
from transcript_studio.main import create_app


def make_wav(seconds: float = 1.0, rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        frames = (int(8000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(seconds * rate)))
        output.writeframes(b"".join(struct.pack("<h", frame) for frame in frames))
    return buffer.getvalue()


class FakeTranscriber:
    """Emits fixed segments; `gate` pauses after the first one so tests can observe a running job."""

    device = "fake"

    def __init__(self) -> None:
        self.calls: list[tuple[Path, str | None, TranscriptionMode]] = []
        self.gate: threading.Event | None = None
        self.started = threading.Event()
        self.segments = [TranscribedSegment(0.0, 2.5, "Bom dia a todos."), TranscribedSegment(2.5, 6.0, "Vamos começar.")]

    def transcribe(self, audio: Path, language: str | None = "pt", mode: TranscriptionMode = "fast",
                   on_segment: OnSegment | None = None, should_stop: ShouldStop | None = None) -> TranscriptionResult:
        self.calls.append((audio, language, mode))
        self.started.set()
        for index, segment in enumerate(self.segments):
            if index == 1 and self.gate is not None:
                while not self.gate.wait(0.02):
                    if should_stop and should_stop():
                        raise TranscriptionCancelled()
            if on_segment:
                on_segment(segment, 6.0)
        return TranscriptionResult(list(self.segments), 6.0, "pt")

    def warm_up(self) -> None:
        self.warmed = True

    def unload(self) -> None:
        pass


class FakeGpu:
    def __init__(self) -> None:
        self.released = 0

    def release_gpu(self) -> None:
        self.released += 1


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", frontend_dist=tmp_path / "no-dist", ollama_url="http://127.0.0.1:9")


@pytest.fixture
def transcriber() -> FakeTranscriber:
    return FakeTranscriber()


@pytest.fixture
def gpu() -> FakeGpu:
    return FakeGpu()


@pytest.fixture
def client(settings: Settings, transcriber: FakeTranscriber, gpu: FakeGpu) -> Iterator[TestClient]:
    with TestClient(create_app(settings, transcriber=transcriber, gpu=gpu)) as test_client:
        yield test_client
