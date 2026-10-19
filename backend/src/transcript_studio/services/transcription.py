"""Runs transcription jobs on the GPU worker thread."""
from __future__ import annotations

import time
from collections.abc import Callable

from transcript_studio.domain.errors import NotFoundError
from transcript_studio.domain.ports import (
    AudioStorage, GpuReleaser, TranscribedSegment, Transcriber, TranscriptionCancelled, UnitOfWork,
)
from transcript_studio.models import JobStatus, Segment, utcnow
from transcript_studio.services.events import JobEvents
from transcript_studio.services.gpu_worker import JobContext
from transcript_studio.services.jobs import JobReporter, finish, job_payload, rest_status

_FLUSH_SECONDS = 0.75  # how often partial segments are pushed to the browser


class TranscriptionJobHandler:
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
            report = JobReporter(uow, self._events, job)
            if context.cancelled():
                report.settle(meeting, JobStatus.cancelled, "Cancelada")
                return
            report.start("Carregando o modelo")

            started = time.monotonic()
            pending: list[TranscribedSegment] = []
            last_flush = 0.0

            def flush(total: float) -> None:
                if not pending:
                    return
                batch = [{"start": s.start, "end": s.end, "text": s.text} for s in pending]
                pending.clear()
                if job.message != "Transcrevendo":
                    report.status("Transcrevendo")
                job.progress = min(0.99, batch[-1]["end"] / total) if total else job.progress
                uow.jobs.save(job)
                report.publish({"type": "segments", "segments": batch, "progress": job.progress})

            def on_segment(segment: TranscribedSegment, total: float) -> None:
                nonlocal last_flush
                pending.append(segment)
                now = time.monotonic()
                if now - last_flush >= _FLUSH_SECONDS:
                    last_flush = now
                    flush(total)

            try:
                self._gpu.release_gpu()
                if not meeting.audio_filename:
                    raise NotFoundError("O áudio foi removido.")
                path = self._audio.path(meeting.id, meeting.audio_filename)
                # Batched mode decodes the whole file and runs VAD before the first segment (~40 s for 70 min).
                report.status("Preparando o áudio e detectando a fala")
                result = self._transcriber.transcribe(
                    path, job.params.get("language"), job.params.get("mode", "fast"),
                    on_segment=on_segment, should_stop=context.cancelled,
                )
                flush(result.duration)
            except TranscriptionCancelled:
                report.settle(meeting, JobStatus.cancelled, "Cancelada")
                return
            except Exception as error:  # surfaced to the user through the job
                job.error = str(error) or type(error).__name__
                report.settle(meeting, JobStatus.error, "Falhou")
                return

            uow.segments.replace_for(meeting.id, [
                Segment(meeting_id=meeting.id, idx=i, start=round(s.start, 2), end=round(s.end, 2), text=s.text)
                for i, s in enumerate(result.segments)
            ])
            meeting.transcript = "\n".join(s.text for s in result.segments) or None
            meeting.status = rest_status(meeting, bool(uow.minutes.list_for(meeting.id)))
            meeting.updated_at = utcnow()
            uow.meetings.save(meeting)

            job.progress = 1.0
            job.audio_seconds = result.duration
            job.elapsed_seconds = round(time.monotonic() - started, 2)
            job.device = getattr(self._transcriber, "device", None)
            speed = result.duration / job.elapsed_seconds if job.elapsed_seconds else 0
            finish(job, JobStatus.done, f"{len(result.segments)} trechos · {speed:.0f}x o tempo real")
            uow.jobs.save(job)
            report.publish({"type": "done", "job": job_payload(job)})
