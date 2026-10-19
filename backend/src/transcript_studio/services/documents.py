"""Transcript and minutes of a meeting: reading, manual editing and versioning."""
from __future__ import annotations

from transcript_studio.domain.ports import MinutesRepository, SegmentRepository
from transcript_studio.models import MeetingStatus, Minutes
from transcript_studio.schemas.meeting import MinutesBundle, MinutesRead, MinutesVersion, SegmentRead, TranscriptRead
from transcript_studio.services.meetings import MeetingService


class TranscriptService:
    def __init__(self, meetings: MeetingService, segments: SegmentRepository) -> None:
        self._meetings = meetings
        self._segments = segments

    def read(self, meeting_id: str) -> TranscriptRead:
        meeting = self._meetings.get(meeting_id)
        segments = [SegmentRead.model_validate(segment, from_attributes=True)
                    for segment in self._segments.list_for(meeting.id)]
        return TranscriptRead(text=meeting.transcript or "", segments=segments)

    def replace(self, meeting_id: str, text: str) -> TranscriptRead:
        meeting = self._meetings.get(meeting_id)
        text = text.strip()
        if text != (meeting.transcript or ""):
            # Timed segments no longer match free-edited text.
            self._segments.delete_for(meeting.id)
        meeting.transcript = text or None
        if text and meeting.status in (MeetingStatus.draft, MeetingStatus.audio_ready, MeetingStatus.error):
            meeting.status = MeetingStatus.transcribed
        self._meetings.touch(meeting)
        return self.read(meeting_id)


class MinutesService:
    def __init__(self, meetings: MeetingService, minutes: MinutesRepository) -> None:
        self._meetings = meetings
        self._minutes = minutes

    def bundle(self, meeting_id: str) -> MinutesBundle:
        meeting = self._meetings.get(meeting_id)
        versions = self._minutes.list_for(meeting.id)
        current = MinutesRead.model_validate(versions[0], from_attributes=True) if versions else None
        return MinutesBundle(current=current,
                             history=[MinutesVersion.model_validate(v, from_attributes=True) for v in versions])

    def add_version(self, meeting_id: str, markdown: str, model: str | None) -> MinutesBundle:
        """Never overwrites: every save becomes a new version in the history."""
        meeting = self._meetings.get(meeting_id)
        self._minutes.add(Minutes(meeting_id=meeting.id, markdown=markdown.strip() + "\n", model=model))
        meeting.status = MeetingStatus.done
        self._meetings.touch(meeting)
        return self.bundle(meeting_id)
