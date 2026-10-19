"""Queueing GPU jobs (request side) and the bookkeeping shared by every job handler."""
from __future__ import annotations

from collections.abc import Callable

from transcript_studio.domain.errors import ConflictError, NotFoundError
from transcript_studio.domain.ports import JobRepository, MinutesRepository, TranscriptionMode, UnitOfWork
from transcript_studio.models import Job, JobKind, JobStatus, Meeting, MeetingStatus, utcnow
from transcript_studio.services.events import JobEvents
from transcript_studio.services.meetings import MeetingService


class JobService:
    def __init__(self, jobs: JobRepository, minutes: MinutesRepository, meetings: MeetingService,
                 submit: Callable[[str], None], cancel: Callable[[str], None], default_llm: str) -> None:
        self._jobs = jobs
        self._minutes = minutes
        self._meetings = meetings
        self._submit = submit
        self._cancel = cancel
        self._default_llm = default_llm

    def transcribe(self, meeting_id: str, language: str | None, mode: TranscriptionMode) -> Job:
        meeting = self._meetings.get(meeting_id)
        if not meeting.audio_filename:
            raise ConflictError("Esta reunião não tem áudio para transcrever.")
        return self._enqueue(meeting, JobKind.transcribe, MeetingStatus.transcribing,
                             {"language": language or meeting.language, "mode": mode},
                             audio_seconds=meeting.audio_duration)

    def generate_minutes(self, meeting_id: str, model: str | None) -> Job:
        meeting = self._meetings.get(meeting_id)
        if not (meeting.transcript or "").strip():
            raise ConflictError("Transcreva a reunião antes de gerar a ata.")
        return self._enqueue(meeting, JobKind.minutes, MeetingStatus.generating, {"model": model or self._default_llm})

    def get(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise NotFoundError(f"Tarefa {job_id} não encontrada.")
        return job

    def latest_for(self, meeting_id: str, kind: JobKind | None = None) -> Job | None:
        self._meetings.get(meeting_id)
        return self._jobs.latest_for(meeting_id, kind)

    def active(self) -> list[Job]:
        return self._jobs.list_active()

    def cancel(self, job_id: str) -> Job:
        job = self.get(job_id)
        if job.status.active:
            self._cancel(job.id)
            if job.status == JobStatus.queued:
                # Not started yet: the worker will skip it, so settle it here.
                finish(job, JobStatus.cancelled, "Cancelada")
                self._jobs.save(job)
                meeting = self._meetings.get(job.meeting_id)
                meeting.status = rest_status(meeting, bool(self._minutes.list_for(meeting.id)))
                self._meetings.touch(meeting)
        return job

    def _enqueue(self, meeting: Meeting, kind: JobKind, busy: MeetingStatus, params: dict[str, object],
                 audio_seconds: float | None = None) -> Job:
        if active := self._jobs.active_for(meeting.id):
            raise ConflictError(f"Já existe uma tarefa em andamento para esta reunião ({active.id}).")
        job = self._jobs.save(Job(meeting_id=meeting.id, kind=kind, params=params, audio_seconds=audio_seconds,
                                  message="Na fila"))
        meeting.status = busy
        self._meetings.touch(meeting)
        self._submit(job.id)
        return job


class JobReporter:
    """Writes job state and publishes it to the browser; shared by all handlers."""

    def __init__(self, uow: UnitOfWork, events: JobEvents, job: Job) -> None:
        self._uow = uow
        self._events = events
        self.job = job

    def start(self, message: str) -> None:
        self.job.status, self.job.started_at, self.job.message = JobStatus.running, utcnow(), message
        self._uow.jobs.save(self.job)
        self._events.publish(self.job.id, {"type": "status", "status": "running", "message": message})

    def status(self, message: str, progress: float | None = None) -> None:
        self.job.message = message
        if progress is not None:
            self.job.progress = progress
        self._uow.jobs.save(self.job)
        self._events.publish(self.job.id, {"type": "status", "status": self.job.status.value, "message": message,
                                           "progress": self.job.progress})

    def publish(self, event: dict[str, object]) -> None:
        self._events.publish(self.job.id, event)

    def settle(self, meeting: Meeting, status: JobStatus, message: str) -> None:
        """Ends the job; the meeting goes back to the status its content implies (or error)."""
        finish(self.job, status, message)
        self._uow.jobs.save(self.job)
        has_minutes = bool(self._uow.minutes.list_for(meeting.id))
        meeting.status = MeetingStatus.error if status == JobStatus.error else rest_status(meeting, has_minutes)
        meeting.updated_at = utcnow()
        self._uow.meetings.save(meeting)
        self._events.publish(self.job.id, {"type": status.value, "job": job_payload(self.job)})


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


def finish(job: Job, status: JobStatus, message: str) -> None:
    job.status, job.message, job.finished_at = status, message, utcnow()


def rest_status(meeting: Meeting, has_minutes: bool) -> MeetingStatus:
    if has_minutes:
        return MeetingStatus.done
    if meeting.transcript:
        return MeetingStatus.transcribed
    return MeetingStatus.audio_ready if meeting.audio_filename else MeetingStatus.draft


def job_payload(job: Job) -> dict[str, object]:
    return job.model_dump(mode="json")
