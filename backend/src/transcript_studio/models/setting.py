from __future__ import annotations

from sqlmodel import Field, SQLModel


class AppSetting(SQLModel, table=True):
    """User preferences changed from the UI (defaults come from core/config.py)."""

    key: str = Field(primary_key=True)
    value: str
