"""Composition root: the only place that picks concrete implementations for the ports."""
from __future__ import annotations

from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.container import Container, ContainerGpuGate
from transcript_studio.infrastructure.audio_storage import FileAudioStorage
from transcript_studio.infrastructure.ollama_client import OllamaClient
from transcript_studio.infrastructure.waveform import CachedWaveform
from transcript_studio.repositories.sql import (
    SqlChatRepository, SqlJobRepository, SqlMeetingRepository, SqlMinutesRepository, SqlSegmentRepository, SqlSettingRepository,
)
from transcript_studio.infrastructure.context_files import ContextFilesService, MarkdownContextSource
from transcript_studio.services.llm_models import LlmModelService
from transcript_studio.services.preferences import PreferencesService
from transcript_studio.infrastructure.docx_renderer import DocxRenderer
from transcript_studio.services.chat import ChatService
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


def get_preferences(session: SessionDep, settings: SettingsDep) -> PreferencesService:
    return PreferencesService(SqlSettingRepository(session), settings)


PreferencesDep = Annotated[PreferencesService, Depends(get_preferences)]


def get_job_service(session: SessionDep, meetings: MeetingServiceDep, container: ContainerDep,
                    preferences: PreferencesDep) -> JobService:
    return JobService(SqlJobRepository(session), SqlMinutesRepository(session), meetings, container.worker.submit,
                      container.worker.cancel, preferences.get().default_llm)


JobServiceDep = Annotated[JobService, Depends(get_job_service)]


def get_export_service(meetings: MeetingServiceDep, transcripts: TranscriptServiceDep,
                       minutes: MinutesServiceDep) -> ExportService:
    return ExportService(meetings, transcripts, minutes, DocxRenderer())


ExportServiceDep = Annotated[ExportService, Depends(get_export_service)]


def get_llm_models(ollama: OllamaDep, settings: SettingsDep) -> LlmModelService:
    return LlmModelService(OllamaClient(settings.ollama_url, timeout=10), settings.gpu_memory_gb)


def get_context_files(settings: SettingsDep) -> ContextFilesService:
    return ContextFilesService(settings.context_dir)


LlmModelsDep = Annotated[LlmModelService, Depends(get_llm_models)]
ContextFilesDep = Annotated[ContextFilesService, Depends(get_context_files)]


def get_chat_service(session: SessionDep, settings: SettingsDep, container: ContainerDep, meetings: MeetingServiceDep,
                     transcripts: TranscriptServiceDep, minutes: MinutesServiceDep,
                     preferences: PreferencesDep) -> ChatService:
    return ChatService(
        meetings, transcripts, minutes, SqlChatRepository(session), container.chat,
        MarkdownContextSource(settings.context_dir, lambda: preferences.get().context_max_chars),
        ContainerGpuGate(container), lambda: preferences.get().default_llm,
    )


ChatServiceDep = Annotated[ChatService, Depends(get_chat_service)]
