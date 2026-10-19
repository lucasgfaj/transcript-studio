from __future__ import annotations

import time
from typing import Any

import numpy as np
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession

from transcript_studio.core.config import Settings
from tests.conftest import FakeGpu, FakeTranscriber
from tests.test_live_segmenter import silence, tone


def pcm(audio: np.ndarray) -> bytes:
    return (audio * 32767).astype("<i2").tobytes()


def stream(ws: WebSocketTestSession, audio: np.ndarray, block: float = 0.25) -> None:
    size = int(16_000 * block)
    for i in range(0, len(audio), size):
        ws.send_bytes(pcm(audio[i:i + size]))


def until(ws: WebSocketTestSession, kind: str) -> list[dict[str, Any]]:
    messages = []
    while True:
        messages.append(ws.receive_json())
        if messages[-1]["type"] == kind:
            return messages


SPEECH = np.concatenate([tone(3), silence(1), tone(2.5), silence(1)])


def test_live_recording_streams_segments_and_saves_the_meeting(client: TestClient, transcriber: FakeTranscriber,
                                                               gpu: FakeGpu, settings: Settings) -> None:
    with client.websocket_connect("/api/live") as ws:
        ws.send_json({"type": "start", "title": "Ao vivo", "participants": ["Ana"], "language": "pt"})
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        meeting_id = ready["meeting_id"]
        assert client.app.state.container.worker.held  # type: ignore[attr-defined]
        stream(ws, SPEECH)
        ws.send_json({"type": "stop"})
        messages = until(ws, "saved")

    segments = [m for m in messages if m["type"] == "segment"]
    assert [s["text"] for s in segments] == ["trecho 1", "trecho 2"]
    assert segments[0]["start"] == 0 and 3.2 <= segments[1]["start"] <= 4.0
    assert transcriber.live_prompts == ["", "trecho 1"]  # previous text is passed for continuity
    assert gpu.released >= 1
    assert not client.app.state.container.worker.held  # type: ignore[attr-defined]

    meeting = client.get(f"/api/meetings/{meeting_id}").json()
    assert meeting["source"] == "live" and meeting["status"] == "transcribed"
    assert meeting["participants"] == ["Ana"]
    assert abs(meeting["audio_duration"] - 7.5) < 0.1
    transcript = client.get(f"/api/meetings/{meeting_id}/transcript").json()
    assert [s["text"] for s in transcript["segments"]] == ["trecho 1", "trecho 2"]
    assert not (settings.meetings_dir / meeting_id / ".live.wav").exists()
    assert client.get(f"/api/meetings/{meeting_id}/audio", headers={"Range": "bytes=0-43"}).status_code == 206


def test_warns_when_the_microphone_sends_only_silence(client: TestClient) -> None:
    dead = (np.random.default_rng(0).uniform(-0.0002, 0.0002, 16_000 * 5)).astype(np.float32)  # like a muted mic
    with client.websocket_connect("/api/live") as ws:
        ws.send_json({"type": "start", "title": "Mudo"})
        ws.receive_json()
        stream(ws, dead)
        assert ws.receive_json() == {"type": "silence", "silent": True}
        stream(ws, tone(0.5))
        assert ws.receive_json() == {"type": "silence", "silent": False}
        ws.send_json({"type": "stop"})
        until(ws, "saved")


def test_closing_the_tab_still_saves(client: TestClient) -> None:
    with client.websocket_connect("/api/live") as ws:
        ws.send_json({"type": "start", "title": "Fechou a aba"})
        meeting_id = ws.receive_json()["meeting_id"]
        stream(ws, SPEECH)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and not client.get(f"/api/meetings/{meeting_id}").json().get("has_audio"):
        time.sleep(0.05)
    meeting = client.get(f"/api/meetings/{meeting_id}").json()
    # The whole recording is kept even if the server task was interrupted before transcribing all of it.
    assert meeting["has_audio"] and abs(meeting["audio_duration"] - 7.5) < 0.1


def test_nothing_recorded_is_discarded(client: TestClient) -> None:
    with client.websocket_connect("/api/live") as ws:
        ws.send_json({"type": "start", "title": "Vazia"})
        meeting_id = ws.receive_json()["meeting_id"]
        ws.send_json({"type": "stop"})
        assert ws.receive_json() == {"type": "discarded"}
    assert client.get(f"/api/meetings/{meeting_id}").status_code == 404


def test_gpu_jobs_wait_while_recording(client: TestClient, transcriber: FakeTranscriber) -> None:
    upload = client.post("/api/meetings/from-audio",
                         files={"file": ("a.wav", _wav(tone(1)), "audio/wav")}).json()
    with client.websocket_connect("/api/live") as ws:
        ws.send_json({"type": "start", "title": "Gravando"})
        ws.receive_json()
        job = client.post(f"/api/meetings/{upload['id']}/transcribe").json()
        time.sleep(0.3)
        assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "queued"
        ws.send_json({"type": "stop"})
        until(ws, "discarded")
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and client.get(f"/api/jobs/{job['id']}").json()["status"] != "done":
        time.sleep(0.05)
    assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "done"


def _wav(audio: np.ndarray) -> bytes:
    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(16_000)
        out.writeframes(pcm(audio))
    return buffer.getvalue()
