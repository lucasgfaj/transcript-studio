from __future__ import annotations

import io
import math
import struct
import threading
import wave
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from transcript_studio.core.config import Settings
from transcript_studio.domain.ports import (
    GenerationCancelled, OnSegment, ShouldStop, TranscribedSegment, TranscriptionCancelled, TranscriptionMode, TranscriptionResult,
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
        self.live_prompts: list[str | None] = []
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

    def transcribe_samples(self, samples: Any, language: str | None = "pt", offset: float = 0.0,
                           prompt: str | None = None) -> list[TranscribedSegment]:
        self.live_prompts.append(prompt)
        duration = len(samples) / 16_000
        return [TranscribedSegment(offset, offset + duration, f"trecho {len(self.live_prompts)}")]

    def warm_up(self) -> None:
        self.warmed = True

    def unload(self) -> None:
        self.unloads = getattr(self, "unloads", 0) + 1


class FakeChat:
    """Streams a canned answer word by word; records every prompt it received."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, str]] = []
        self.answer = "# Ata\n\n## Decisões\n\n- Orçamento **aprovado**.\n\n## Tarefas\n\n- [ ] Bruno envia o orçamento.\n"
        self.gate: threading.Event | None = None
        self.max_tokens: list[int | None] = []

    def stream(self, model: str, system: str, prompt: str, should_stop: ShouldStop | None = None,
               max_tokens: int | None = None) -> Iterator[str]:
        self.calls.append((model, system, prompt))
        self.max_tokens.append(max_tokens)
        final = "Elabore a ata" in prompt
        words = (self.answer if final else "Nota: orçamento aprovado.").split(" ")
        for index, word in enumerate(words):
            if index == 2 and self.gate is not None:
                while not self.gate.wait(0.02):
                    if should_stop and should_stop():
                        raise GenerationCancelled()
            yield word if index == len(words) - 1 else word + " "


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
def chat() -> FakeChat:
    return FakeChat()


@pytest.fixture
def client(settings: Settings, transcriber: FakeTranscriber, gpu: FakeGpu, chat: FakeChat) -> Iterator[TestClient]:
    with TestClient(create_app(settings, transcriber=transcriber, gpu=gpu, chat=chat)) as test_client:
        yield test_client
