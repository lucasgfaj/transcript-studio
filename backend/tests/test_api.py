from __future__ import annotations

import io
import math
import struct
import wave
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from transcript_studio.core.config import Settings
from transcript_studio.main import create_app


def make_wav(seconds: float = 1.0, rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(rate)
        frames = (int(8000 * math.sin(2 * math.pi * 440 * i / rate)) for i in range(int(seconds * rate)))
        output.writeframes(b"".join(struct.pack("<h", frame) for frame in frames))
    return buffer.getvalue()


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(data_dir=tmp_path / "data", frontend_dist=tmp_path / "no-dist", ollama_url="http://127.0.0.1:9")


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_meeting_crud(client: TestClient) -> None:
    created = client.post("/api/meetings", json={"title": "Diretoria", "participants": [" Ana ", "", "Bruno"],
                                                  "date": "2026-10-01"})
    assert created.status_code == 201
    meeting = created.json()
    assert meeting["participants"] == ["Ana", "Bruno"]
    assert meeting["status"] == "draft"

    updated = client.patch(f"/api/meetings/{meeting['id']}", json={"title": "Diretoria Financeira"}).json()
    assert updated["title"] == "Diretoria Financeira"
    assert updated["participants"] == ["Ana", "Bruno"]

    assert [m["id"] for m in client.get("/api/meetings", params={"q": "bruno"}).json()] == [meeting["id"]]
    assert client.get("/api/meetings", params={"q": "inexistente"}).json() == []

    assert client.delete(f"/api/meetings/{meeting['id']}").status_code == 204
    assert client.get(f"/api/meetings/{meeting['id']}").status_code == 404


def test_audio_upload_stream_with_range_and_delete(client: TestClient, settings: Settings) -> None:
    response = client.post("/api/meetings/from-audio", files={"file": ("reuniao_semanal.wav", make_wav(2.0), "audio/wav")},
                           data={"participants": "Ana"})
    assert response.status_code == 201, response.text
    meeting = response.json()
    assert meeting["title"] == "reuniao semanal"
    assert meeting["status"] == "audio_ready"
    assert meeting["audio_duration"] == pytest.approx(2.0, abs=0.05)

    partial = client.get(f"/api/meetings/{meeting['id']}/audio", headers={"Range": "bytes=0-99"})
    assert partial.status_code == 206
    assert len(partial.content) == 100

    peaks = client.get(f"/api/meetings/{meeting['id']}/audio/peaks").json()
    assert len(peaks) == 1_600 and max(peaks) == 1.0

    client.delete(f"/api/meetings/{meeting['id']}")
    assert not (settings.meetings_dir / meeting["id"]).exists()


def test_invalid_audio_is_rejected_and_nothing_is_left(client: TestClient) -> None:
    response = client.post("/api/meetings/from-audio", files={"file": ("x.wav", b"not audio", "audio/wav")})
    assert response.status_code == 422
    assert client.get("/api/meetings").json() == []


def test_transcript_and_minutes_versions(client: TestClient) -> None:
    meeting = client.post("/api/meetings", json={"title": "Obra"}).json()
    transcript = client.put(f"/api/meetings/{meeting['id']}/transcript", json={"text": "  Começamos a obra.  "}).json()
    assert transcript == {"text": "Começamos a obra.", "segments": []}
    assert client.get(f"/api/meetings/{meeting['id']}").json()["status"] == "transcribed"

    client.put(f"/api/meetings/{meeting['id']}/minutes", json={"markdown": "# Ata v1"})
    bundle = client.put(f"/api/meetings/{meeting['id']}/minutes", json={"markdown": "# Ata v2"}).json()
    assert bundle["current"]["markdown"] == "# Ata v2\n"
    assert len(bundle["history"]) == 2

    listed = client.get("/api/meetings").json()[0]
    assert listed["has_minutes"] is True
    assert listed["status"] == "done"
    assert listed["transcript_preview"] == "Começamos a obra."


def test_health_reports_ollama_offline(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["ollama"] is False
