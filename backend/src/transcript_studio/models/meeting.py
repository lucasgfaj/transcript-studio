"""Model (MVC): persisted entities. Business rules live in services, not here."""
from __future__ import annotations

import uuid
from datetime import date as Date, datetime, timezone
from enum import Enum

from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class MeetingStatus(str, Enum):
    draft = "draft"              # created, no audio or text yet
    audio_ready = "audio_ready"  # audio stored, waiting for transcription
    transcribing = "transcribing"
    transcribed = "transcribed"
    generating = "generating"
    done = "done"                # minutes available
    error = "error"


class MeetingSource(str, Enum):
    upload = "upload"
    recording = "recording"
    live = "live"
    imported = "import"
    manual = "manual"


class MeetingFields(SQLModel):
    title: str = Field(min_length=1, max_length=200)
    participants: list[str] = Field(default_factory=list, sa_column=Column(JSON, nullable=False))
    date: Date = Field(default_factory=Date.today)
    language: str = "pt"


class Meeting(MeetingFields, table=True):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex, primary_key=True)
    source: MeetingSource = MeetingSource.manual
    source_ref: str | None = Field(default=None, index=True)  # original path for imported meetings
    status: MeetingStatus = MeetingStatus.draft
    audio_filename: str | None = None
    audio_mime: str | None = None
    audio_size: int | None = None
    audio_duration: float | None = None
    transcript: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)


class Segment(SQLModel, table=True):
    """A timed piece of the transcript; filled by the transcription job (phase 2)."""

    id: int | None = Field(default=None, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True, ondelete="CASCADE")
    idx: int
    start: float | None = None
    end: float | None = None
    text: str


class Minutes(SQLModel, table=True):
    """Each generation or manual edit is a new version; the latest one is current."""

    id: int | None = Field(default=None, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True, ondelete="CASCADE")
    markdown: str
    model: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
