"""Copies meetings from the old transcript-mk folders into Transcript Studio (originals are untouched).

    uv run python -m transcript_studio.services.importer ~/transcript-mk
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from transcript_studio.domain.errors import InvalidAudioError
from transcript_studio.models import MeetingSource
from transcript_studio.schemas.meeting import MeetingCreate
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services.meetings import MeetingService

_SLUG_DATE = re.compile(r"^(?P<name>.+?)-(?P<date>\d{4}-\d{2}-\d{2})-(?P<time>\d{4})$")
_AUDIO_NAMES = ("audio", "recording")
_TRANSCRIPT_NAMES = ("transcricao.txt", "transcript.txt")


@dataclass(frozen=True)
class LegacyMeeting:
    folder: Path
    title: str
    date: date
    audio: Path | None
    transcript: str | None
    minutes: str | None


@dataclass
class ImportReport:
    imported: list[str]
    skipped: list[str]
    warnings: list[str]


def discover(root: Path) -> list[LegacyMeeting]:
    folders = sorted([*root.glob("reunioes/*/"), *root.glob("storage/meetings/*/")])
    return [meeting for folder in folders if (meeting := _read_folder(root, folder))]


def _read_folder(root: Path, folder: Path) -> LegacyMeeting | None:
    match = _SLUG_DATE.match(folder.name)
    name, day = (match["name"], date.fromisoformat(match["date"])) if match else (folder.name, date.today())
    audio = next((p for p in sorted(folder.iterdir()) if p.stem in _AUDIO_NAMES and p.is_file()), None)
    transcript = next(((folder / n).read_text(encoding="utf-8").strip() for n in _TRANSCRIPT_NAMES
                       if (folder / n).is_file()), None)
    minutes_file = folder / "ata.md"
    agenda_file = root / "pautas" / f"pauta-{folder.name}.md"  # older runs wrote the minutes only here
    minutes = next((f.read_text(encoding="utf-8").strip() for f in (minutes_file, agenda_file) if f.is_file()), None)
    if not (audio or transcript or minutes):
        return None
    return LegacyMeeting(folder, _title(name), day, audio, transcript or None, minutes or None)


def _title(slug: str) -> str:
    words = slug.replace("_", "-").split("-")
    return " ".join(word if word.isupper() else word.capitalize() for word in words if word) or "Reunião"


def import_meetings(root: Path, meetings: MeetingService, transcripts: TranscriptService,
                    minutes: MinutesService) -> ImportReport:
    report = ImportReport([], [], [])
    for legacy in discover(root):
        ref = str(legacy.folder.resolve())
        if meetings.find_by_source(ref):
            report.skipped.append(legacy.folder.name)
            continue
        meeting = meetings.create(MeetingCreate(title=legacy.title, date=legacy.date), MeetingSource.imported, ref)
        if legacy.audio:
            try:
                meetings.attach_audio(meeting.id, legacy.audio.name, legacy.audio)
            except InvalidAudioError as error:
                report.warnings.append(f"{legacy.folder.name}: áudio ignorado ({error})")
        if legacy.transcript:
            transcripts.replace(meeting.id, legacy.transcript)
        if legacy.minutes:
            minutes.add_version(meeting.id, legacy.minutes, model="transcript-mk")
        report.imported.append(legacy.folder.name)
    return report


def main() -> int:
    from sqlmodel import Session

    from transcript_studio.core.config import get_settings
    from transcript_studio.core.db import make_engine
    from transcript_studio.core.dependencies import build_meeting_service
    from transcript_studio.repositories.sql import SqlMinutesRepository, SqlSegmentRepository

    parser = argparse.ArgumentParser(description="Importa reuniões do transcript-mk.")
    parser.add_argument("root", type=Path, help="Pasta do transcript-mk")
    args = parser.parse_args()
    settings = get_settings()
    with Session(make_engine(settings)) as session:
        meetings = build_meeting_service(session, settings)
        report = import_meetings(args.root.expanduser(), meetings,
                                 TranscriptService(meetings, SqlSegmentRepository(session)),
                                 MinutesService(meetings, SqlMinutesRepository(session)))
    print(f"Importadas: {len(report.imported)} | Já existiam: {len(report.skipped)}")
    for name in report.imported:
        print(f"  + {name}")
    for warning in report.warnings:
        print(f"  ! {warning}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
