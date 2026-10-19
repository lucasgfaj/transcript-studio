from __future__ import annotations

from pathlib import Path

from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.db import make_engine
from transcript_studio.core.dependencies import build_meeting_service
from transcript_studio.repositories.sql import SqlMinutesRepository, SqlSegmentRepository
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services.importer import import_meetings
from tests.conftest import make_wav


def test_imports_legacy_folders_once(tmp_path: Path) -> None:
    legacy = tmp_path / "transcript-mk"
    adm = legacy / "reunioes" / "adm-2026-09-24-1602"
    adm.mkdir(parents=True)
    (adm / "audio.wav").write_bytes(make_wav(1.0))
    (adm / "transcricao.txt").write_text("Texto da reunião.", encoding="utf-8")
    romeu = legacy / "reunioes" / "romeu-2026-09-24-1531"
    romeu.mkdir(parents=True)
    (romeu / "transcricao.txt").write_text("Outra.", encoding="utf-8")
    (legacy / "pautas").mkdir()
    (legacy / "pautas" / "pauta-romeu-2026-09-24-1531.md").write_text("# Ata Romeu", encoding="utf-8")
    broken = legacy / "storage" / "meetings" / "vazia-2026-10-02-1611"
    broken.mkdir(parents=True)
    (broken / "recording.wav").write_bytes(b"RIFF")

    settings = Settings(data_dir=tmp_path / "data")
    with Session(make_engine(settings)) as session:
        meetings = build_meeting_service(session, settings)
        services = (meetings, TranscriptService(meetings, SqlSegmentRepository(session)),
                    MinutesService(meetings, SqlMinutesRepository(session)))
        first = import_meetings(legacy, *services)
        second = import_meetings(legacy, *services)
        listed = {m.title: m for m in meetings.list()}

    assert sorted(first.imported) == ["adm-2026-09-24-1602", "romeu-2026-09-24-1531", "vazia-2026-10-02-1611"]
    assert len(first.warnings) == 1
    assert second.imported == [] and len(second.skipped) == 3
    assert listed["Adm"].has_audio and listed["Adm"].status == "transcribed"
    assert str(listed["Adm"].date) == "2026-09-24"
    assert listed["Romeu"].has_minutes and listed["Romeu"].status == "done"
    assert (adm / "audio.wav").exists()  # originals stay in place
