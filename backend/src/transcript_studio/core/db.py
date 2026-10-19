from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlmodel import SQLModel, create_engine

from transcript_studio.core.config import Settings


def make_engine(settings: Settings) -> Engine:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(connection, _record) -> None:  # type: ignore[no-untyped-def]
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")   # needed for ON DELETE CASCADE
        cursor.execute("PRAGMA journal_mode=WAL")  # readers do not block the job writer
        cursor.close()

    import transcript_studio.models  # noqa: F401  (registers the tables)
    SQLModel.metadata.create_all(engine)
    return engine
