"""Runs minutes generation jobs on the GPU worker thread, streaming the answer to the browser."""
from __future__ import annotations

import time
from collections.abc import Callable

from transcript_studio.domain.ports import ContextSource, GenerationCancelled, Transcriber, UnitOfWork
from transcript_studio.models import JobStatus, MeetingStatus, Minutes, utcnow
from transcript_studio.services.events import JobEvents
from transcript_studio.services.gpu_worker import JobContext
from transcript_studio.services.jobs import JobReporter, finish, job_payload
from transcript_studio.services.minutes_writer import MinutesRequest, MinutesWriter

_FLUSH_SECONDS = 0.12  # token batches to the browser: smooth typing without one event per token


class MinutesJobHandler:
    def __init__(self, uow: Callable[[], UnitOfWork], writer: MinutesWriter, context: ContextSource,
                 transcriber: Transcriber, events: JobEvents) -> None:
        self._uow = uow
        self._writer = writer
        self._context = context
        self._transcriber = transcriber
        self._events = events

    def run(self, job_id: str, context: JobContext) -> None:
        with self._uow() as uow:
            job = uow.jobs.get(job_id)
            meeting = uow.meetings.get(job.meeting_id) if job else None
            if job is None or meeting is None or job.status != JobStatus.queued:
                return
            report = JobReporter(uow, self._events, job)
            if context.cancelled():
                report.settle(meeting, JobStatus.cancelled, "Cancelada")
                return
            model = str(job.params.get("model"))
            report.start(f"Carregando {model}")
            # Whisper and the LLM do not fit together in 6 GB: free the GPU before Ollama loads.
            self._transcriber.unload()

            started = time.monotonic()
            buffer: list[str] = []
            last_flush = 0.0

            def flush() -> None:
                if buffer:
                    report.publish({"type": "token", "text": "".join(buffer)})
                    buffer.clear()

            def on_token(piece: str) -> None:
                nonlocal last_flush
                buffer.append(piece)
                now = time.monotonic()
                if now - last_flush >= _FLUSH_SECONDS:
                    last_flush = now
                    flush()

            def on_step(message: str, progress: float) -> None:
                report.status(message, progress)

            request = MinutesRequest(meeting.title, tuple(meeting.participants), meeting.date.isoformat(),
                                     meeting.transcript or "", self._context.load())
            try:
                markdown = self._writer.write(request, model, on_token=on_token, on_step=on_step,
                                              should_stop=context.cancelled)
                flush()
            except GenerationCancelled:
                report.settle(meeting, JobStatus.cancelled, "Cancelada")
                return
            except Exception as error:  # surfaced to the user through the job
                job.error = str(error) or type(error).__name__
                report.settle(meeting, JobStatus.error, "Falhou")
                return

            uow.minutes.add(Minutes(meeting_id=meeting.id, markdown=markdown, model=model))
            meeting.status, meeting.updated_at = MeetingStatus.done, utcnow()
            uow.meetings.save(meeting)
            job.progress = 1.0
            job.elapsed_seconds = round(time.monotonic() - started, 2)
            finish(job, JobStatus.done, f"Ata gerada com {model} em {job.elapsed_seconds:.0f} s")
            uow.jobs.save(job)
            report.publish({"type": "done", "job": job_payload(job)})
