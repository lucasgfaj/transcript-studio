"""Controller (MVC): HTTP in, service call, schema out. No business rules here."""
from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse

from transcript_studio.core.dependencies import MeetingServiceDep, MinutesServiceDep, TranscriptServiceDep
from transcript_studio.models import MeetingSource, MeetingStatus
from transcript_studio.schemas.meeting import (
    MeetingCreate, MeetingRead, MeetingUpdate, MinutesBundle, MinutesUpdate, TranscriptRead, TranscriptUpdate,
)
from transcript_studio.services.meetings import to_read

router = APIRouter(prefix="/api/meetings", tags=["meetings"])


@router.get("", response_model=list[MeetingRead])
def list_meetings(service: MeetingServiceDep, q: str | None = None,
                  status_filter: Annotated[MeetingStatus | None, Query(alias="status")] = None) -> list[MeetingRead]:
    return service.list(q, status_filter)


@router.post("", response_model=MeetingRead, status_code=status.HTTP_201_CREATED)
def create_meeting(data: MeetingCreate, service: MeetingServiceDep) -> MeetingRead:
    return to_read(service.create(data), has_minutes=False)


@router.post("/from-audio", response_model=MeetingRead, status_code=status.HTTP_201_CREATED)
def create_from_audio(service: MeetingServiceDep, file: UploadFile = File(...), title: str = Form(""),
                      participants: str = Form(""), meeting_date: date | None = Form(None, alias="date"),
                      language: str = Form("pt"), source: MeetingSource = Form(MeetingSource.upload)) -> MeetingRead:
    """Creates the meeting and stores its audio in one request (drag-and-drop and browser recordings)."""
    name = file.filename or "audio.wav"
    data = MeetingCreate(title=title.strip() or _title_from_filename(name),
                         participants=participants.split(","), date=meeting_date or date.today(), language=language)
    meeting = service.create(data, source=source)
    try:
        meeting = service.attach_audio(meeting.id, name, file.file)
    except Exception:
        service.delete(meeting.id)
        raise
    return to_read(meeting, has_minutes=False)


@router.get("/{meeting_id}", response_model=MeetingRead)
def get_meeting(meeting_id: str, service: MeetingServiceDep) -> MeetingRead:
    return service.read(meeting_id)


@router.patch("/{meeting_id}", response_model=MeetingRead)
def update_meeting(meeting_id: str, data: MeetingUpdate, service: MeetingServiceDep) -> MeetingRead:
    service.update(meeting_id, data)
    return service.read(meeting_id)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_meeting(meeting_id: str, service: MeetingServiceDep) -> None:
    service.delete(meeting_id)


# ---- audio ------------------------------------------------------------------------------------

@router.put("/{meeting_id}/audio", response_model=MeetingRead)
def upload_audio(meeting_id: str, service: MeetingServiceDep, file: UploadFile = File(...)) -> MeetingRead:
    service.attach_audio(meeting_id, file.filename or "audio.wav", file.file)
    return service.read(meeting_id)


@router.get("/{meeting_id}/audio")
def stream_audio(meeting_id: str, service: MeetingServiceDep) -> FileResponse:
    path, mime = service.audio_file(meeting_id)
    return FileResponse(path, media_type=mime)  # Starlette answers Range requests, so seeking works


@router.get("/{meeting_id}/audio/peaks", response_model=list[float])
def audio_peaks(meeting_id: str, service: MeetingServiceDep) -> list[float]:
    return service.waveform(meeting_id)


@router.delete("/{meeting_id}/audio", response_model=MeetingRead)
def delete_audio(meeting_id: str, service: MeetingServiceDep) -> MeetingRead:
    service.remove_audio(meeting_id)
    return service.read(meeting_id)


# ---- transcript and minutes ---------------------------------------------------------------------

@router.get("/{meeting_id}/transcript", response_model=TranscriptRead)
def get_transcript(meeting_id: str, service: TranscriptServiceDep) -> TranscriptRead:
    return service.read(meeting_id)


@router.put("/{meeting_id}/transcript", response_model=TranscriptRead)
def put_transcript(meeting_id: str, data: TranscriptUpdate, service: TranscriptServiceDep) -> TranscriptRead:
    return service.replace(meeting_id, data.text)


@router.get("/{meeting_id}/minutes", response_model=MinutesBundle)
def get_minutes(meeting_id: str, service: MinutesServiceDep) -> MinutesBundle:
    return service.bundle(meeting_id)


@router.put("/{meeting_id}/minutes", response_model=MinutesBundle)
def put_minutes(meeting_id: str, data: MinutesUpdate, service: MinutesServiceDep) -> MinutesBundle:
    return service.add_version(meeting_id, data.markdown, model="manual")


def _title_from_filename(name: str) -> str:
    stem = name.rsplit(".", 1)[0].replace("_", " ").replace("-", " ").strip()
    return stem[:200] or "Reunião"
