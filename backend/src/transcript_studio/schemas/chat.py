from __future__ import annotations

from datetime import datetime

from sqlmodel import Field, SQLModel

from transcript_studio.models import ChatRole


class ChatMessageRead(SQLModel):
    id: int
    role: ChatRole
    content: str
    model: str | None
    interrupted: bool
    created_at: datetime


class ChatQuestion(SQLModel):
    content: str = Field(min_length=1, max_length=4_000)
    model: str | None = None
