"""Composition root: the only place that picks concrete implementations for the ports."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.container import Container
from transcript_studio.infrastructure.audio_storage import FileAudioStorage
from transcript_studio.infrastructure.ollama_client import OllamaClient
from transcript_studio.infrastructure.waveform import CachedWaveform
from transcript_studio.repositories.sql import (
    SqlJobRepository, SqlMeetingRepository, SqlMinutesRepository, SqlSegmentRepository,
)
from transcript_studio.infrastructure.docx_renderer import DocxRenderer
from transcript_studio.services.documents import MinutesService, TranscriptService
from transcript_studio.services.export import ExportService
from transcript_studio.services.jobs import JobService
from transcript_studio.services.meetings import MeetingService


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings)]
SessionDep = Annotated[Session, Depends(get_session)]


def build_meeting_service(session: Session, settings: Settings) -> MeetingService:
    return MeetingService(SqlMeetingRepository(session), SqlMinutesRepository(session),
                          FileAudioStorage(settings.meetings_dir), CachedWaveform())


def get_meeting_service(session: SessionDep, settings: SettingsDep) -> MeetingService:
    return build_meeting_service(session, settings)


MeetingServiceDep = Annotated[MeetingService, Depends(get_meeting_service)]


def get_transcript_service(session: SessionDep, meetings: MeetingServiceDep) -> TranscriptService:
    return TranscriptService(meetings, SqlSegmentRepository(session))


def get_minutes_service(session: SessionDep, meetings: MeetingServiceDep) -> MinutesService:
    return MinutesService(meetings, SqlMinutesRepository(session))


def get_ollama(settings: SettingsDep) -> OllamaClient:
    return OllamaClient(settings.ollama_url)


TranscriptServiceDep = Annotated[TranscriptService, Depends(get_transcript_service)]
MinutesServiceDep = Annotated[MinutesService, Depends(get_minutes_service)]
OllamaDep = Annotated[OllamaClient, Depends(get_ollama)]


def get_container(request: Request) -> Container:
    return request.app.state.container


ContainerDep = Annotated[Container, Depends(get_container)]


def get_job_service(session: SessionDep, meetings: MeetingServiceDep, container: ContainerDep,
                    settings: SettingsDep) -> JobService:
    return JobService(SqlJobRepository(session), SqlMinutesRepository(session), meetings, container.worker.submit,
                      container.worker.cancel, settings.default_llm)


JobServiceDep = Annotated[JobService, Depends(get_job_service)]


def get_export_service(meetings: MeetingServiceDep, transcripts: TranscriptServiceDep,
                       minutes: MinutesServiceDep) -> ExportService:
    return ExportService(meetings, transcripts, minutes, DocxRenderer())


ExportServiceDep = Annotated[ExportService, Depends(get_export_service)]
