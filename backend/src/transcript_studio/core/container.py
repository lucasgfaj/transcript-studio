"""Long-lived objects (GPU worker, Whisper model, event bus) built once per app; tests inject fakes."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

from sqlalchemy.engine import Engine
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.domain.ports import ChatModel, GpuReleaser, Transcriber
from transcript_studio.infrastructure.audio_storage import FileAudioStorage
from transcript_studio.infrastructure.context_files import MarkdownContextSource
from transcript_studio.repositories.sql import SqlSettingRepository
from transcript_studio.schemas.preferences import PreferencesRead
from transcript_studio.services.preferences import PreferencesService
from transcript_studio.infrastructure.ollama_chat import OllamaChat
from transcript_studio.infrastructure.ollama_client import OllamaClient
from transcript_studio.models import Job, JobKind
from transcript_studio.repositories.sql import SqlUnitOfWork
from transcript_studio.services.events import JobEvents
from transcript_studio.services.gpu_worker import GpuWorker
from transcript_studio.services.jobs import recover_interrupted_jobs
from transcript_studio.services.minutes_job import MinutesJobHandler
from transcript_studio.services.minutes_writer import MinutesWriter
from transcript_studio.services.transcription import TranscriptionJobHandler


@dataclass
class Container:
    engine: Engine
    events: JobEvents
    worker: GpuWorker
    transcriber: Transcriber
    gpu: GpuReleaser
    chat: ChatModel
    live_sessions: int = field(default=0)


class ContainerGpuGate:
    """GpuGate for the chat: waits for the running GPU job, then frees Whisper so the LLM has the VRAM."""

    def __init__(self, container: Container) -> None:
        self._container = container

    @property
    def busy(self) -> bool:
        return self._container.worker.current is not None

    @property
    def recording(self) -> bool:
        return self._container.live_sessions > 0

    @contextmanager
    def exclusive(self) -> Iterator[None]:
        with self._container.worker.exclusive():
            self._container.transcriber.unload()
            yield


def build_container(settings: Settings, engine: Engine, transcriber: Transcriber | None = None,
                    gpu: GpuReleaser | None = None, chat: ChatModel | None = None) -> Container:
    def preferences() -> PreferencesRead:
        with Session(engine) as session:
            return PreferencesService(SqlSettingRepository(session), settings).get()

    if transcriber is None:
        from transcript_studio.infrastructure.whisper import FasterWhisperTranscriber
        transcriber = FasterWhisperTranscriber(preferences().whisper_model, batch_size=settings.whisper_batch_size)
    events = JobEvents()
    gpu = gpu or OllamaClient(settings.ollama_url)

    def uow() -> SqlUnitOfWork:
        return SqlUnitOfWork(engine)

    transcription = TranscriptionJobHandler(uow, FileAudioStorage(settings.meetings_dir), transcriber,
                                            gpu, events)
    chat = chat or OllamaChat(settings.ollama_url, settings.llm_context_tokens)
    minutes = MinutesJobHandler(
        uow,
        MinutesWriter(chat, settings.minutes_chunk_chars),
        MarkdownContextSource(settings.context_dir, lambda: preferences().context_max_chars),
        transcriber,
        events,
    )

    def kind_of(job_id: str) -> JobKind | None:
        with Session(engine) as session:
            job = session.get(Job, job_id)
            return job.kind if job else None

    worker = GpuWorker({JobKind.transcribe: transcription, JobKind.minutes: minutes}, kind_of)
    return Container(engine, events, worker, transcriber, gpu, chat)


def start(container: Container, settings: Settings) -> None:
    container.worker.start()
    if settings.whisper_preload:
        container.worker.call_soon(container.transcriber.warm_up)
    recover_interrupted_jobs(lambda: SqlUnitOfWork(container.engine), container.worker.submit)


def stop(container: Container) -> None:
    container.worker.stop()
