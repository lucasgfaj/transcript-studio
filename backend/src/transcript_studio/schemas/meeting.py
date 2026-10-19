"""Request/response contracts of the HTTP API (what the React view consumes)."""
from __future__ import annotations

from datetime import date as Date, datetime

from sqlmodel import Field, SQLModel

from transcript_studio.models import MeetingFields, MeetingSource, MeetingStatus


class MeetingCreate(MeetingFields):
    pass


class MeetingUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    participants: list[str] | None = None
    date: Date | None = None
    language: str | None = None


class MeetingRead(MeetingFields):
    id: str
    source: MeetingSource
    status: MeetingStatus
    audio_filename: str | None
    audio_size: int | None
    audio_duration: float | None
    has_audio: bool
    has_transcript: bool
    has_minutes: bool
    transcript_preview: str | None
    created_at: datetime
    updated_at: datetime


class SegmentRead(SQLModel):
    idx: int
    start: float | None
    end: float | None
    text: str


class TranscriptRead(SQLModel):
    text: str
    segments: list[SegmentRead]


class TranscriptUpdate(SQLModel):
    text: str


class MinutesRead(SQLModel):
    id: int
    markdown: str
    model: str | None
    created_at: datetime


class MinutesVersion(SQLModel):
    id: int
    model: str | None
    created_at: datetime


class MinutesBundle(SQLModel):
    current: MinutesRead | None
    history: list[MinutesVersion]


class MinutesUpdate(SQLModel):
    markdown: str = Field(min_length=1)


class HealthRead(SQLModel):
    ok: bool
    ollama: bool
    ollama_version: str | None
    default_llm: str
