"""Business rules for meetings and their audio. Depends only on ports (see domain/ports.py)."""
from __future__ import annotations

from pathlib import Path
from typing import BinaryIO

from transcript_studio.domain.errors import NotFoundError
from transcript_studio.domain.ports import AudioStorage, MeetingRepository, MinutesRepository, WaveformProvider
from transcript_studio.models import Meeting, MeetingSource, MeetingStatus, utcnow
from transcript_studio.schemas.meeting import MeetingCreate, MeetingRead, MeetingUpdate


class MeetingService:
    def __init__(self, meetings: MeetingRepository, minutes: MinutesRepository, audio: AudioStorage,
                 waveform: WaveformProvider) -> None:
        self._meetings = meetings
        self._minutes = minutes
        self._audio = audio
        self._waveform = waveform

    def list(self, query: str | None = None, status: MeetingStatus | None = None) -> list[MeetingRead]:
        with_minutes = self._minutes.meeting_ids_with_minutes()
        return [to_read(meeting, meeting.id in with_minutes) for meeting in self._meetings.list(query, status)]

    def get(self, meeting_id: str) -> Meeting:
        meeting = self._meetings.get(meeting_id)
        if meeting is None:
            raise NotFoundError(f"Reunião {meeting_id} não encontrada.")
        return meeting

    def read(self, meeting_id: str) -> MeetingRead:
        meeting = self.get(meeting_id)
        return to_read(meeting, bool(self._minutes.list_for(meeting.id)))

    def find_by_source(self, source_ref: str) -> Meeting | None:
        return self._meetings.find_by_source(source_ref)

    def create(self, data: MeetingCreate, source: MeetingSource = MeetingSource.manual,
               source_ref: str | None = None) -> Meeting:
        meeting = Meeting.model_validate(data, update={
            "source": source, "source_ref": source_ref, "participants": clean_names(data.participants),
        })
        return self._meetings.save(meeting)

    def update(self, meeting_id: str, data: MeetingUpdate) -> Meeting:
        meeting = self.get(meeting_id)
        changes = data.model_dump(exclude_unset=True, exclude_none=True)
        if "participants" in changes:
            changes["participants"] = clean_names(changes["participants"])
        meeting.sqlmodel_update(changes)
        return self.touch(meeting)

    def delete(self, meeting_id: str) -> None:
        meeting = self.get(meeting_id)
        self._meetings.delete(meeting)
        self._audio.delete_all(meeting.id)

    def attach_audio(self, meeting_id: str, original_name: str, source: BinaryIO | Path) -> Meeting:
        meeting = self.get(meeting_id)
        stored = self._audio.save(meeting.id, original_name, source)
        if meeting.audio_filename and meeting.audio_filename != stored.filename:
            self._audio.delete(meeting.id, meeting.audio_filename)
        meeting.audio_filename, meeting.audio_size = stored.filename, stored.size
        meeting.audio_duration, meeting.audio_mime = stored.duration, stored.mime
        if meeting.status in (MeetingStatus.draft, MeetingStatus.error):
            meeting.status = MeetingStatus.audio_ready
        return self.touch(meeting)

    def remove_audio(self, meeting_id: str) -> Meeting:
        meeting = self.get(meeting_id)
        if meeting.audio_filename:
            self._audio.delete(meeting.id, meeting.audio_filename)
        meeting.audio_filename = meeting.audio_mime = None
        meeting.audio_size = None
        meeting.audio_duration = None
        if meeting.status == MeetingStatus.audio_ready:
            meeting.status = MeetingStatus.draft
        return self.touch(meeting)

    def audio_file(self, meeting_id: str) -> tuple[Path, str]:
        meeting = self.get(meeting_id)
        path = self._audio.path(meeting.id, meeting.audio_filename) if meeting.audio_filename else None
        if path is None or not path.exists():
            raise NotFoundError("Esta reunião não tem áudio.")
        return path, meeting.audio_mime or "application/octet-stream"

    def waveform(self, meeting_id: str) -> list[float]:
        path, _mime = self.audio_file(meeting_id)
        return self._waveform.peaks(path)

    def touch(self, meeting: Meeting) -> Meeting:
        meeting.updated_at = utcnow()
        return self._meetings.save(meeting)


def to_read(meeting: Meeting, has_minutes: bool) -> MeetingRead:
    preview = " ".join((meeting.transcript or "").split())[:240] or None
    return MeetingRead.model_validate(meeting, update={
        "has_audio": meeting.audio_filename is not None,
        "has_transcript": bool(meeting.transcript),
        "has_minutes": has_minutes,
        "transcript_preview": preview,
    })


def clean_names(names: list[str]) -> list[str]:
    return [name.strip() for name in names if name and name.strip()]
