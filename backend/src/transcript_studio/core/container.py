"""Long-lived objects (GPU worker, Whisper model, event bus) built once per app; tests inject fakes."""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.engine import Engine
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.domain.ports import GpuReleaser, Transcriber
from transcript_studio.infrastructure.audio_storage import FileAudioStorage
from transcript_studio.infrastructure.ollama_client import OllamaClient
from transcript_studio.models import Job, JobKind
from transcript_studio.repositories.sql import SqlUnitOfWork
from transcript_studio.services.events import JobEvents
from transcript_studio.services.gpu_worker import GpuWorker
from transcript_studio.services.transcription import TranscriptionJobHandler, recover_interrupted_jobs


@dataclass
class Container:
    engine: Engine
    events: JobEvents
    worker: GpuWorker
    transcriber: Transcriber


def build_container(settings: Settings, engine: Engine, transcriber: Transcriber | None = None,
                    gpu: GpuReleaser | None = None) -> Container:
    if transcriber is None:
        from transcript_studio.infrastructure.whisper import FasterWhisperTranscriber
        transcriber = FasterWhisperTranscriber(settings.default_whisper, batch_size=settings.whisper_batch_size)
    events = JobEvents()
    handler = TranscriptionJobHandler(
        uow=lambda: SqlUnitOfWork(engine),
        audio=FileAudioStorage(settings.meetings_dir),
        transcriber=transcriber,
        gpu=gpu or OllamaClient(settings.ollama_url),
        events=events,
    )

    def kind_of(job_id: str) -> JobKind | None:
        with Session(engine) as session:
            job = session.get(Job, job_id)
            return job.kind if job else None

    worker = GpuWorker({JobKind.transcribe: handler}, kind_of)
    return Container(engine, events, worker, transcriber)


def start(container: Container, settings: Settings) -> None:
    container.worker.start()
    if settings.whisper_preload:
        container.worker.call_soon(container.transcriber.warm_up)
    recover_interrupted_jobs(lambda: SqlUnitOfWork(container.engine), container.worker.submit)


def stop(container: Container) -> None:
    container.worker.stop()
