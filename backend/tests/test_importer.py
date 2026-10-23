from __future__ import annotations

from pathlib import Path

import pytest

from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.db import make_engine
from transcript_studio.core.dependencies import build_meeting_service
from transcript_studio.repositories.sql import SqlMinutesRepository, SqlSegmentRepository
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services import importer
from transcript_studio.services.importer import import_context, import_meetings
from tests.conftest import make_wav


def test_imports_legacy_folders_once(tmp_path: Path) -> None:
    legacy = tmp_path / "transcript-mk"
    adm = legacy / "reunioes" / "adm-2026-09-24-1602"
    adm.mkdir(parents=True)
    (adm / "audio.wav").write_bytes(make_wav(1.0))
    (adm / "transcricao.txt").write_text("Texto da reunião.", encoding="utf-8")
    vendas = legacy / "reunioes" / "vendas-2026-09-24-1531"
    vendas.mkdir(parents=True)
    (vendas / "transcricao.txt").write_text("Outra.", encoding="utf-8")
    (legacy / "pautas").mkdir()
    (legacy / "pautas" / "pauta-vendas-2026-09-24-1531.md").write_text("# Ata Vendas", encoding="utf-8")
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

    assert sorted(first.imported) == ["adm-2026-09-24-1602", "vazia-2026-10-02-1611", "vendas-2026-09-24-1531"]
    assert len(first.warnings) == 1
    assert second.imported == [] and len(second.skipped) == 3
    assert listed["Adm"].has_audio and listed["Adm"].status == "transcribed"
    assert str(listed["Adm"].date) == "2026-09-24"
    assert listed["Vendas"].has_minutes and listed["Vendas"].status == "done"
    assert (adm / "audio.wav").exists()  # originals stay in place


def test_context_is_copied_without_overwriting_local_edits(tmp_path: Path) -> None:
    source = tmp_path / "legado" / "contexto"
    (source / "pessoas").mkdir(parents=True)
    (source / "glossario.md").write_text("antigo", encoding="utf-8")
    (source / "pessoas" / "ana.md").write_text("# Ana", encoding="utf-8")
    target = tmp_path / "context"
    target.mkdir()
    (target / "glossario.md").write_text("editado aqui", encoding="utf-8")

    copied = import_context(tmp_path / "legado", target)

    assert copied == ["pessoas/ana.md"]
    assert (target / "glossario.md").read_text(encoding="utf-8") == "editado aqui"
    assert import_context(tmp_path / "sem-contexto", target) == []


def test_command_line_reports_what_was_imported(tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
                                                capsys: pytest.CaptureFixture[str]) -> None:
    legacy = tmp_path / "legado"
    folder = legacy / "reunioes" / "geral-2026-01-05-0900"
    folder.mkdir(parents=True)
    (folder / "transcricao.txt").write_text("Texto.", encoding="utf-8")
    monkeypatch.setattr("transcript_studio.core.config.get_settings", lambda: Settings(data_dir=tmp_path / "data"))
    monkeypatch.setattr("sys.argv", ["importer", str(legacy)])

    assert importer.main() == 0
    assert "Importadas: 1" in capsys.readouterr().out
