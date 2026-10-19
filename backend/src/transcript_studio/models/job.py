from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel

from transcript_studio.models.meeting import utcnow


class JobKind(str, Enum):
    transcribe = "transcribe"


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    done = "done"
    error = "error"
    cancelled = "cancelled"

    @property
    def active(self) -> bool:
        return self in (JobStatus.queued, JobStatus.running)


class Job(SQLModel, table=True):
    """A unit of GPU work. Jobs run one at a time so Whisper and the LLM never fight over VRAM."""

    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True, ondelete="CASCADE")
    kind: JobKind
    status: JobStatus = Field(default=JobStatus.queued, index=True)
    params: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    progress: float = 0.0          # 0..1
    message: str | None = None
    error: str | None = None
    audio_seconds: float | None = None
    elapsed_seconds: float | None = None  # wall time of the run, to measure speed (x real time)
    device: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
