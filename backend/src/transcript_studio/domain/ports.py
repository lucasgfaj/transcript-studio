"""Interfaces the services depend on (Dependency Inversion). Implementations live in
repositories/ and infrastructure/ and are wired in core/dependencies.py."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, Protocol

from transcript_studio.models import Job, Meeting, MeetingStatus, Minutes, Segment

# fast: batched, ~75x real time, paragraph-sized segments; detailed: sequential, ~32x, sentence timestamps
TranscriptionMode = Literal["fast", "detailed"]


@dataclass(frozen=True)
class TranscribedSegment:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptionResult:
    segments: list[TranscribedSegment]
    duration: float
    language: str | None


class TranscriptionCancelled(Exception):
    pass


OnSegment = Callable[[TranscribedSegment, float], None]  # (segment, total audio seconds)
ShouldStop = Callable[[], bool]


class Transcriber(Protocol):
    def transcribe(self, audio: Path, language: str | None = "pt", mode: TranscriptionMode = "fast",
                   on_segment: OnSegment | None = None, should_stop: ShouldStop | None = None) -> TranscriptionResult: ...
    def warm_up(self) -> None: ...
    def unload(self) -> None: ...


class GpuReleaser(Protocol):
    """Frees GPU memory held by other engines (e.g. Ollama) before a GPU job runs."""

    def release_gpu(self) -> None: ...


class MeetingRepository(Protocol):
    def list(self, query: str | None = None, status: MeetingStatus | None = None) -> list[Meeting]: ...
    def get(self, meeting_id: str) -> Meeting | None: ...
    def find_by_source(self, source_ref: str) -> Meeting | None: ...
    def save(self, meeting: Meeting) -> Meeting: ...
    def delete(self, meeting: Meeting) -> None: ...


class SegmentRepository(Protocol):
    def list_for(self, meeting_id: str) -> list[Segment]: ...
    def delete_for(self, meeting_id: str) -> None: ...
    def replace_for(self, meeting_id: str, segments: list[Segment]) -> None: ...


class JobRepository(Protocol):
    def get(self, job_id: str) -> Job | None: ...
    def save(self, job: Job) -> Job: ...
    def latest_for(self, meeting_id: str) -> Job | None: ...
    def active_for(self, meeting_id: str) -> Job | None: ...
    def list_active(self) -> list[Job]: ...


class MinutesRepository(Protocol):
    def list_for(self, meeting_id: str) -> list[Minutes]: ...
    def meeting_ids_with_minutes(self) -> set[str]: ...
    def add(self, minutes: Minutes) -> Minutes: ...


class UnitOfWork(Protocol):
    """Repositories sharing one session, for work that runs outside an HTTP request (the GPU worker)."""

    jobs: JobRepository
    meetings: MeetingRepository
    segments: SegmentRepository

    def __enter__(self) -> UnitOfWork: ...
    def __exit__(self, *exc: object) -> None: ...


class StoredAudio(Protocol):
    filename: str
    size: int
    duration: float
    mime: str


class WaveformProvider(Protocol):
    def peaks(self, audio: Path) -> list[float]: ...


class AudioStorage(Protocol):
    def save(self, meeting_id: str, original_name: str, source: BinaryIO | Path) -> StoredAudio: ...
    def path(self, meeting_id: str, filename: str) -> Path: ...
    def delete(self, meeting_id: str, filename: str) -> None: ...
    def delete_all(self, meeting_id: str) -> None: ...
