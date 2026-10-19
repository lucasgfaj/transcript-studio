"""Builds downloadable files for a meeting: minutes (md/docx), transcript (txt) and subtitles (srt)."""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Literal

from transcript_studio.domain.errors import NotFoundError
from transcript_studio.domain.ports import DocumentRenderer
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services.meetings import MeetingService

ExportFormat = Literal["md", "docx", "txt", "srt"]


@dataclass(frozen=True)
class ExportFile:
    content: bytes
    media_type: str
    filename: str


class ExportService:
    def __init__(self, meetings: MeetingService, transcripts: TranscriptService, minutes: MinutesService,
                 docx: DocumentRenderer) -> None:
        self._meetings = meetings
        self._transcripts = transcripts
        self._minutes = minutes
        self._docx = docx

    def export(self, meeting_id: str, fmt: ExportFormat) -> ExportFile:
        meeting = self._meetings.get(meeting_id)
        base = f"{_slug(meeting.title)}-{meeting.date.isoformat()}"
        if fmt in ("md", "docx"):
            current = self._minutes.bundle(meeting_id).current
            if current is None:
                raise NotFoundError("Esta reunião ainda não tem ata.")
            if fmt == "md":
                return ExportFile(current.markdown.encode(), "text/markdown; charset=utf-8", f"{base}-ata.md")
            return ExportFile(self._docx.render(current.markdown),
                              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                              f"{base}-ata.docx")
        transcript = self._transcripts.read(meeting_id)
        if not transcript.text:
            raise NotFoundError("Esta reunião ainda não tem transcrição.")
        if fmt == "txt":
            return ExportFile((transcript.text + "\n").encode(), "text/plain; charset=utf-8", f"{base}-transcricao.txt")
        timed = [s for s in transcript.segments if s.start is not None and s.end is not None]
        if not timed:
            raise NotFoundError("A transcrição não tem marcações de tempo para gerar legendas.")
        srt = "\n".join(f"{i}\n{_srt_time(s.start)} --> {_srt_time(s.end)}\n{s.text}\n"  # type: ignore[arg-type]
                        for i, s in enumerate(timed, 1))
        return ExportFile(srt.encode(), "application/x-subrip; charset=utf-8", f"{base}.srt")


def _srt_time(seconds: float) -> str:
    millis = round(seconds * 1000)
    hours, millis = divmod(millis, 3_600_000)
    minutes, millis = divmod(millis, 60_000)
    secs, millis = divmod(millis, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def _slug(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    slug = "".join(c.lower() if c.isalnum() else "-" for c in ascii_value)
    return "-".join(part for part in slug.split("-") if part) or "reuniao"
