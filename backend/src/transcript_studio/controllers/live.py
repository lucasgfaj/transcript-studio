"""WebSocket for live recording.

Protocol (JSON text frames + binary audio):
  client → {"type": "start", "title": str, "participants": [str], "language": "pt"}
  server → {"type": "ready", "meeting_id": str, "gpu_busy": bool}
  client → binary: PCM 16-bit little-endian, 16 kHz, mono (any block size)
  server → {"type": "segment", "start": float, "end": float, "text": str}   (as utterances finish)
  server → {"type": "silence", "silent": bool}   (the microphone sends digital silence for 4 s / recovered)
  client → {"type": "stop"}
  server → {"type": "saved", "meeting_id": str, "segments": int} | {"type": "discarded"}
Closing the socket without "stop" still saves what was recorded.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy.engine import Engine
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.container import Container
from transcript_studio.core.dependencies import build_meeting_service
from transcript_studio.infrastructure.wav_recorder import WavRecorder
from transcript_studio.repositories.sql import SqlSegmentRepository
from transcript_studio.services.documents import TranscriptService
from transcript_studio.services.live import LiveSession, save_meeting, start_meeting
from transcript_studio.services.live_segmenter import Utterance

router = APIRouter(tags=["live"])
_SAVER = ThreadPoolExecutor(max_workers=2, thread_name_prefix="live-save")
log = logging.getLogger(__name__)


@router.websocket("/api/live")
async def live(websocket: WebSocket) -> None:
    await websocket.accept()
    settings: Settings = websocket.app.state.settings
    container: Container = websocket.app.state.container
    engine = websocket.app.state.engine

    try:
        start = await websocket.receive_json()
    except (WebSocketDisconnect, ValueError):
        return
    if start.get("type") != "start":
        await websocket.close(code=1003, reason="Envie {type: start} primeiro")
        return

    with Session(engine) as db:
        meeting_id = start_meeting(build_meeting_service(db, settings), str(start.get("title") or ""),
                                   list(start.get("participants") or []), start.get("language"))
    recording = settings.meetings_dir / meeting_id / ".live.wav"
    session = LiveSession(meeting_id, start.get("language") or "pt", container.transcriber, WavRecorder(recording))

    gpu_busy = container.worker.current is not None
    container.worker.hold()  # no new GPU job starts while recording
    container.live_sessions += 1
    utterances: asyncio.Queue[Utterance | None] = asyncio.Queue()
    saving = False

    async def transcribe_loop() -> None:
        while (utterance := await utterances.get()) is not None:
            try:
                found = await asyncio.to_thread(session.transcribe, utterance)
            except Exception:  # one bad utterance must not end the recording
                log.exception("Live transcription failed")
                continue
            for segment in found:
                with contextlib.suppress(Exception):
                    await websocket.send_json({"type": "segment", "start": segment.start, "end": segment.end,
                                               "text": segment.text})

    try:
        await asyncio.to_thread(_prepare_gpu, container)
        await websocket.send_json({"type": "ready", "meeting_id": meeting_id, "gpu_busy": gpu_busy})
        worker = asyncio.create_task(transcribe_loop())
        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes"):
                    was_silent = session.silent
                    for utterance in session.push(message["bytes"]):
                        utterances.put_nowait(utterance)
                    if session.silent != was_silent:
                        await websocket.send_json({"type": "silence", "silent": session.silent})
                elif message.get("text") and _is_stop(message["text"]):
                    break
        except WebSocketDisconnect:
            pass
        for utterance in session.finish():
            utterances.put_nowait(utterance)
        utterances.put_nowait(None)
        await worker

        # Submitted synchronously and awaited through shield(): if this task is cancelled now (server
        # shutting down, client gone) the save still runs. asyncio.to_thread would be cancelled before
        # starting, and a second save from the finally block would race this one on the same files.
        saving = True
        saved = await asyncio.shield(asyncio.wrap_future(_SAVER.submit(_save, settings, engine, session, recording)))
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "saved", "meeting_id": meeting_id, "segments": len(session.segments)}
                                      if saved else {"type": "discarded"})
            await websocket.close()
    finally:
        if not saving:
            # Cancelled (server shutting down) or crashed mid-recording: keep the audio and the text so far.
            session.finish()
            try:
                _save(settings, engine, session, recording)
            except Exception:
                log.exception("Could not save the live recording of meeting %s", meeting_id)
        container.live_sessions -= 1
        container.worker.release()


def _is_stop(text: str) -> bool:
    try:
        return json.loads(text).get("type") == "stop"
    except (ValueError, AttributeError):
        return False


def _prepare_gpu(container: Container) -> None:
    container.gpu.release_gpu()  # the LLM leaves the GPU to Whisper
    container.transcriber.warm_up()


def _save(settings: Settings, engine: Engine, session: LiveSession, recording: Path) -> bool:
    with Session(engine) as db:
        meetings = build_meeting_service(db, settings)
        return save_meeting(meetings, TranscriptService(meetings, SqlSegmentRepository(db)), session, recording)
