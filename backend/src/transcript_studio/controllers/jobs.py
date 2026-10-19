"""Controller for GPU jobs: queue a transcription, follow it live (SSE), cancel it."""
from __future__ import annotations

import asyncio
import json
import queue
from collections.abc import AsyncIterator

from fastapi import APIRouter, Request, status
from fastapi.responses import StreamingResponse

from transcript_studio.core.dependencies import ContainerDep, JobServiceDep
from transcript_studio.models import Job
from transcript_studio.schemas.meeting import JobRead, TranscribeRequest

router = APIRouter(prefix="/api", tags=["jobs"])

_KEEPALIVE_SECONDS = 15
_FINAL = {"done", "error", "cancelled"}


def _read(job: Job) -> JobRead:
    return JobRead.model_validate(job, from_attributes=True)


@router.post("/meetings/{meeting_id}/transcribe", response_model=JobRead, status_code=status.HTTP_202_ACCEPTED)
def transcribe(meeting_id: str, service: JobServiceDep, body: TranscribeRequest | None = None) -> JobRead:
    body = body or TranscribeRequest()
    return _read(service.transcribe(meeting_id, body.language, body.mode))


@router.get("/meetings/{meeting_id}/job", response_model=JobRead | None)
def latest_job(meeting_id: str, service: JobServiceDep) -> JobRead | None:
    job = service.latest_for(meeting_id)
    return _read(job) if job else None


@router.get("/jobs", response_model=list[JobRead])
def active_jobs(service: JobServiceDep) -> list[JobRead]:
    return [_read(job) for job in service.active()]


@router.get("/jobs/{job_id}", response_model=JobRead)
def get_job(job_id: str, service: JobServiceDep) -> JobRead:
    return _read(service.get(job_id))


@router.post("/jobs/{job_id}/cancel", response_model=JobRead)
def cancel_job(job_id: str, service: JobServiceDep) -> JobRead:
    return _read(service.cancel(job_id))


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, request: Request, service: JobServiceDep, container: ContainerDep) -> StreamingResponse:
    """Server-Sent Events: a snapshot (job + segments so far), then segments/progress until it ends."""
    service.get(job_id)  # 404 before opening the stream
    subscriber, partial = container.events.subscribe(job_id)

    async def stream() -> AsyncIterator[str]:
        try:
            # Read the job after subscribing, so an event published in between is not lost.
            job = service.get(job_id)
            yield _sse({"type": "snapshot", "job": _read(job).model_dump(mode="json"), "segments": partial})
            if not job.status.active:
                return
            while not await request.is_disconnected():
                try:
                    event = await asyncio.to_thread(subscriber.get, True, _KEEPALIVE_SECONDS)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield _sse(event)
                if event.get("type") in _FINAL:
                    return
        finally:
            container.events.unsubscribe(job_id, subscriber)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(event: dict[str, object]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
