from __future__ import annotations

import json
import threading
import time
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from transcript_studio.core.config import Settings
from transcript_studio.core.db import make_engine
from transcript_studio.main import create_app
from transcript_studio.models import Job, JobKind, JobStatus
from tests.conftest import FakeGpu, FakeTranscriber, make_wav


def upload(client: TestClient, seconds: float = 1.0) -> dict[str, Any]:
    response = client.post("/api/meetings/from-audio", files={"file": ("reuniao.wav", make_wav(seconds), "audio/wav")})
    assert response.status_code == 201, response.text
    return response.json()


def wait_for(client: TestClient, job_id: str, status: str, timeout: float = 5) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] == status:
            return job
        time.sleep(0.02)
    raise AssertionError(f"job never reached {status}: {job}")


def test_transcription_saves_timed_segments_and_frees_gpu_first(client: TestClient, transcriber: FakeTranscriber,
                                                                gpu: FakeGpu) -> None:
    meeting = upload(client)
    transcriber.gate = threading.Event()  # hold the fake so the in-progress status can be observed
    response = client.post(f"/api/meetings/{meeting['id']}/transcribe", json={"mode": "detailed", "language": "pt"})
    assert response.status_code == 202
    assert client.get(f"/api/meetings/{meeting['id']}").json()["status"] == "transcribing"
    transcriber.gate.set()

    job = wait_for(client, response.json()["id"], "done")
    assert job["progress"] == 1.0
    assert job["elapsed_seconds"] is not None and job["device"] == "fake"
    assert "tempo real" in job["message"]
    assert transcriber.calls[0][1:] == ("pt", "detailed")
    assert gpu.released == 1

    transcript = client.get(f"/api/meetings/{meeting['id']}/transcript").json()
    assert transcript["text"] == "Bom dia a todos.\nVamos começar."
    assert transcript["segments"][1] == {"idx": 1, "start": 2.5, "end": 6.0, "text": "Vamos começar."}
    assert client.get(f"/api/meetings/{meeting['id']}").json()["status"] == "transcribed"
    assert client.get(f"/api/meetings/{meeting['id']}/job").json()["id"] == job["id"]


def test_rejects_meeting_without_audio_and_duplicate_jobs(client: TestClient, transcriber: FakeTranscriber) -> None:
    empty = client.post("/api/meetings", json={"title": "Sem áudio"}).json()
    assert client.post(f"/api/meetings/{empty['id']}/transcribe").status_code == 409

    transcriber.gate = threading.Event()
    meeting = upload(client)
    first = client.post(f"/api/meetings/{meeting['id']}/transcribe").json()
    assert client.post(f"/api/meetings/{meeting['id']}/transcribe").status_code == 409
    active = client.get("/api/jobs").json()
    assert [(j["id"], j["meeting_title"]) for j in active] == [(first["id"], "reuniao")]
    transcriber.gate.set()
    wait_for(client, first["id"], "done")


def test_events_stream_snapshot_segments_and_done(client: TestClient, transcriber: FakeTranscriber) -> None:
    transcriber.gate = threading.Event()
    meeting = upload(client)
    job = client.post(f"/api/meetings/{meeting['id']}/transcribe").json()
    assert transcriber.started.wait(5)
    time.sleep(0.05)

    events: list[dict[str, Any]] = []
    with client.stream("GET", f"/api/jobs/{job['id']}/events") as stream:
        for line in stream.iter_lines():
            if not line.startswith("data: "):
                continue
            events.append(json.loads(line[6:]))
            if events[-1]["type"] == "snapshot":
                transcriber.gate.set()
            if events[-1]["type"] == "done":
                break

    assert events[0]["type"] == "snapshot"
    assert events[0]["job"]["status"] == "running"
    streamed = [s["text"] for e in events for s in e.get("segments", [])]
    assert streamed == ["Bom dia a todos.", "Vamos começar."]
    assert events[-1]["job"]["status"] == "done"


def test_finished_job_stream_returns_only_snapshot(client: TestClient) -> None:
    meeting = upload(client)
    job = client.post(f"/api/meetings/{meeting['id']}/transcribe").json()
    wait_for(client, job["id"], "done")
    body = client.get(f"/api/jobs/{job['id']}/events").text
    assert body.count("data: ") == 1 and '"snapshot"' in body


def test_cancel_running_job_restores_meeting_status(client: TestClient, transcriber: FakeTranscriber) -> None:
    transcriber.gate = threading.Event()
    meeting = upload(client)
    job = client.post(f"/api/meetings/{meeting['id']}/transcribe").json()
    assert transcriber.started.wait(5)
    client.post(f"/api/jobs/{job['id']}/cancel")
    wait_for(client, job["id"], "cancelled")
    assert client.get(f"/api/meetings/{meeting['id']}").json()["status"] == "audio_ready"
    assert client.get(f"/api/meetings/{meeting['id']}/transcript").json()["segments"] == []


def test_jobs_interrupted_by_a_restart_are_resumed(settings: Settings, transcriber: FakeTranscriber, gpu: FakeGpu) -> None:
    with TestClient(create_app(settings, transcriber=transcriber, gpu=gpu)) as client:
        meeting = upload(client)
    with Session(make_engine(settings)) as session:
        session.add(Job(id="interrupted", meeting_id=meeting["id"], kind=JobKind.transcribe, status=JobStatus.running))
        session.commit()

    with TestClient(create_app(settings, transcriber=transcriber, gpu=gpu)) as client:
        wait_for(client, "interrupted", "done")
        assert client.get(f"/api/meetings/{meeting['id']}").json()["has_transcript"] is True
