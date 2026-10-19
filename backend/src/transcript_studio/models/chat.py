from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

from transcript_studio.models.meeting import utcnow


class ChatRole(str, Enum):
    user = "user"
    assistant = "assistant"


class ChatMessage(SQLModel, table=True):
    """One turn of the conversation about a meeting."""

    id: int | None = Field(default=None, primary_key=True)
    meeting_id: str = Field(foreign_key="meeting.id", index=True, ondelete="CASCADE")
    role: ChatRole
    content: str
    model: str | None = None
    interrupted: bool = False
    created_at: datetime = Field(default_factory=utcnow)
