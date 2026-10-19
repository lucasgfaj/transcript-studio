"""Transcription use cases: queueing a job (request side) and running it (GPU worker side)."""
from __future__ import annotations

import time
from collections.abc import Callable

from transcript_studio.domain.errors import ConflictError, NotFoundError
from transcript_studio.domain.ports import (
    AudioStorage, GpuReleaser, JobRepository, TranscribedSegment, Transcriber, TranscriptionCancelled,
    TranscriptionMode, UnitOfWork,
)
from transcript_studio.models import Job, JobKind, JobStatus, Meeting, MeetingStatus, Segment, utcnow
from transcript_studio.services.events import JobEvents
from transcript_studio.services.gpu_worker import JobContext
from transcript_studio.services.meetings import MeetingService

_FLUSH_SECONDS = 0.75  # how often partial segments are pushed to the browser


class JobService:
    def __init__(self, jobs: JobRepository, meetings: MeetingService, submit: Callable[[str], None],
                 cancel: Callable[[str], None]) -> None:
        self._jobs = jobs
        self._meetings = meetings
        self._submit = submit
        self._cancel = cancel

    def transcribe(self, meeting_id: str, language: str | None, mode: TranscriptionMode) -> Job:
        meeting = self._meetings.get(meeting_id)
        if not meeting.audio_filename:
            raise ConflictError("Esta reunião não tem áudio para transcrever.")
        if active := self._jobs.active_for(meeting.id):
            raise ConflictError(f"Já existe uma tarefa em andamento para esta reunião ({active.id}).")
        job = self._jobs.save(Job(meeting_id=meeting.id, kind=JobKind.transcribe,
                                  params={"language": language or meeting.language, "mode": mode},
                                  audio_seconds=meeting.audio_duration, message="Na fila"))
        meeting.status = MeetingStatus.transcribing
        self._meetings.touch(meeting)
        self._submit(job.id)
        return job

    def get(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"Tarefa {job_id} não encontrada.")
        return job

    def latest_for(self, meeting_id: str) -> Job | None:
        self._meetings.get(meeting_id)
        return self._jobs.latest_for(meeting_id)

    def active(self) -> list[Job]:
        return self._jobs.list_active()

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status.active:
            self._cancel(job.id)
            if job.status == JobStatus.queued:
                # Not started yet: the worker will skip it, so settle it here.
                _finish(job, JobStatus.cancelled, "Cancelada")
                self._jobs.save(job)
                meeting = self._meetings.get(job.meeting_id)
                meeting.status = _status_without_transcription(meeting)
                self._meetings.touch(meeting)
        return job


class TranscriptionJobHandler:
    """Runs on the GPU worker thread."""

    def __init__(self, uow: Callable[[], UnitOfWork], audio: AudioStorage, transcriber: Transcriber,
                 gpu: GpuReleaser, events: JobEvents) -> None:
        self._uow = uow
        self._audio = audio
        self._transcriber = transcriber
        self._gpu = gpu
        self._events = events

    def run(self, job_id: str, context: JobContext) -> None:
        with self._uow() as uow:
            job = uow.jobs.get(job_id)
            meeting = uow.meetings.get(job.meeting_id) if job else None
            if job is None or meeting is None or job.status != JobStatus.queued:
                return
            if context.cancelled():
                self._settle(uow, job, meeting, JobStatus.cancelled, "Cancelada")
                return
            job.status, job.started_at, job.message = JobStatus.running, utcnow(), "Carregando o modelo"
            uow.jobs.save(job)
            self._events.publish(job.id, {"type": "status", "status": "running", "message": job.message})

            started = time.monotonic()
            pending: list[TranscribedSegment] = []
            last_flush = 0.0

            def on_segment(segment: TranscribedSegment, total: float) -> None:
                nonlocal last_flush
                pending.append(segment)
                now = time.monotonic()
                if now - last_flush >= _FLUSH_SECONDS:
                    last_flush = now
                    self._flush(uow, job, pending, total)

            try:
                self._gpu.release_gpu()
                if not meeting.audio_filename:
                    raise NotFoundError("O áudio foi removido.")
                path = self._audio.path(meeting.id, meeting.audio_filename)
                # Batched mode decodes the whole file and runs VAD before the first segment (~40 s for 70 min).
                self._status(uow, job, "Preparando o áudio e detectando a fala")
                result = self._transcriber.transcribe(
                    path, job.params.get("language"), job.params.get("mode", "fast"),
                    on_segment=on_segment, should_stop=context.cancelled,
                )
                self._flush(uow, job, pending, result.duration)
            except TranscriptionCancelled:
                self._settle(uow, job, meeting, JobStatus.cancelled, "Cancelada")
                return
            except Exception as error:  # surfaced to the user through the job
                job.error = str(error) or type(error).__name__
                self._settle(uow, job, meeting, JobStatus.error, "Falhou")
                return

            uow.segments.replace_for(meeting.id, [
                Segment(meeting_id=meeting.id, idx=i, start=round(s.start, 2), end=round(s.end, 2), text=s.text)
                for i, s in enumerate(result.segments)
            ])
            meeting.transcript = "\n".join(s.text for s in result.segments) or None
            meeting.status = MeetingStatus.transcribed if meeting.transcript else _status_without_transcription(meeting)
            if result.language and not meeting.language:
                meeting.language = result.language
            meeting.updated_at = utcnow()
            uow.meetings.save(meeting)

            job.progress = 1.0
            job.audio_seconds = result.duration
            job.elapsed_seconds = round(time.monotonic() - started, 2)
            job.device = getattr(self._transcriber, "device", None)
            speed = result.duration / job.elapsed_seconds if job.elapsed_seconds else 0
            _finish(job, JobStatus.done, f"{len(result.segments)} trechos · {speed:.0f}x o tempo real")
            uow.jobs.save(job)
            self._events.publish(job.id, {"type": "done", "job": _job_payload(job)})

    def _flush(self, uow: UnitOfWork, job: Job, pending: list[TranscribedSegment], total: float) -> None:
        if not pending:
            return
        batch = [{"start": s.start, "end": s.end, "text": s.text} for s in pending]
        pending.clear()
        if job.message != "Transcrevendo":
            self._status(uow, job, "Transcrevendo")
        job.progress = min(0.99, batch[-1]["end"] / total) if total else job.progress
        uow.jobs.save(job)
        self._events.publish(job.id, {"type": "segments", "segments": batch, "progress": job.progress})

    def _status(self, uow: UnitOfWork, job: Job, message: str) -> None:
        job.message = message
        uow.jobs.save(job)
        self._events.publish(job.id, {"type": "status", "status": job.status.value, "message": message})

    def _settle(self, uow: UnitOfWork, job: Job, meeting: Meeting, status: JobStatus, message: str) -> None:
        _finish(job, status, message)
        uow.jobs.save(job)
        meeting.status = _status_without_transcription(meeting) if status != JobStatus.error else MeetingStatus.error
        meeting.updated_at = utcnow()
        uow.meetings.save(meeting)
        self._events.publish(job.id, {"type": status.value, "job": _job_payload(job)})


def recover_interrupted_jobs(uow_factory: Callable[[], UnitOfWork], submit: Callable[[str], None]) -> int:
    """After a restart, jobs left queued/running go back into the queue in their original order."""
    with uow_factory() as uow:
        jobs = uow.jobs.list_active()
        for job in jobs:
            if job.status == JobStatus.running:
                job.status, job.progress, job.message = JobStatus.queued, 0.0, "Retomada após reinício"
                uow.jobs.save(job)
            submit(job.id)
        return len(jobs)


def _finish(job: Job, status: JobStatus, message: str) -> None:
    job.status, job.message, job.finished_at = status, message, utcnow()


def _status_without_transcription(meeting: Meeting) -> MeetingStatus:
    if meeting.transcript:
        return MeetingStatus.transcribed
    return MeetingStatus.audio_ready if meeting.audio_filename else MeetingStatus.draft


def _job_payload(job: Job) -> dict[str, object]:
    return job.model_dump(mode="json")
