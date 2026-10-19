from __future__ import annotations

import json
import threading
import time
from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import FakeChat, FakeTranscriber, make_wav


def ready_meeting(client: TestClient) -> str:
    meeting = client.post("/api/meetings/from-audio", files={"file": ("obra.wav", make_wav(1), "audio/wav")},
                          data={"title": "Obra Sul", "participants": "Ana, Bruno"}).json()
    job = client.post(f"/api/meetings/{meeting['id']}/transcribe").json()
    deadline = time.monotonic() + 5
    while client.get(f"/api/jobs/{job['id']}").json()["status"] != "done" and time.monotonic() < deadline:
        time.sleep(0.02)
    client.put(f"/api/meetings/{meeting['id']}/minutes", json={"markdown": "# Ata\n\n- Orçamento aprovado."})
    return meeting["id"]


def ask(client: TestClient, meeting_id: str, question: str) -> list[dict[str, Any]]:
    response = client.post(f"/api/meetings/{meeting_id}/chat", json={"content": question})
    assert response.status_code == 200, response.text
    return [json.loads(line) for line in response.text.splitlines()]


def test_answer_streams_from_minutes_and_timed_excerpts(client: TestClient, chat: FakeChat,
                                                        transcriber: FakeTranscriber) -> None:
    meeting_id = ready_meeting(client)
    events = ask(client, meeting_id, "O que foi decidido sobre o orçamento?")

    assert events[0]["type"] == "status"
    answer = "".join(e["text"] for e in events if e["type"] == "token")
    assert answer.strip() == "Foi aprovado o orçamento [00:00] da obra."
    assert events[-1]["type"] == "done" and events[-1]["message"]["role"] == "assistant"
    assert transcriber.unloads >= 1  # Whisper left the GPU for the LLM

    model, messages = chat.chat_calls[-1]
    assert model == "qwen3.5:4b"
    system = messages[0]["content"]
    assert "Obra Sul" in system and "Ana, Bruno" in system
    assert "Orçamento aprovado" in system  # the minutes
    assert "[00:00] Bom dia a todos." in system  # timed transcript excerpt
    assert messages[-1] == {"role": "user", "content": "O que foi decidido sobre o orçamento?"}

    history = client.get(f"/api/meetings/{meeting_id}/chat").json()
    assert [m["role"] for m in history] == ["user", "assistant"]


def test_citations_snap_to_the_segment_that_contains_them() -> None:
    from transcript_studio.services.chat import snap_citations

    spans = [(32.0, 61.5), (61.5, 90.0), (3600.0, 3630.0)]
    text = "Venda [00:38] e comissão [01:03]; fim [1:00:12]; fora [10:00]."
    assert snap_citations(text, spans) == "Venda [00:32] e comissão [01:01]; fim [1:00:00]; fora [01:01]."
    assert snap_citations("sem horário [00:05]", []) == "sem horário [00:05]"


def test_follow_up_questions_carry_the_conversation(client: TestClient, chat: FakeChat) -> None:
    meeting_id = ready_meeting(client)
    ask(client, meeting_id, "Quem estava?")
    ask(client, meeting_id, "E o que ela disse?")
    _model, messages = chat.chat_calls[-1]
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user"]
    assert messages[1]["content"] == "Quem estava?"


def test_clear_history(client: TestClient) -> None:
    meeting_id = ready_meeting(client)
    ask(client, meeting_id, "Resuma")
    assert client.delete(f"/api/meetings/{meeting_id}/chat").status_code == 204
    assert client.get(f"/api/meetings/{meeting_id}/chat").json() == []


def test_refuses_without_material_or_while_recording(client: TestClient) -> None:
    empty = client.post("/api/meetings", json={"title": "Vazia"}).json()
    assert client.post(f"/api/meetings/{empty['id']}/chat", json={"content": "oi"}).status_code == 409

    meeting_id = ready_meeting(client)
    container = client.app.state.container  # type: ignore[attr-defined]
    container.live_sessions = 1
    try:
        assert client.post(f"/api/meetings/{meeting_id}/chat", json={"content": "oi"}).status_code == 409
    finally:
        container.live_sessions = 0
    assert client.get(f"/api/meetings/{meeting_id}/chat").json() == []  # refused questions are not stored


def test_waits_for_a_running_gpu_job(client: TestClient) -> None:
    meeting_id = ready_meeting(client)
    worker = client.app.state.container.worker  # type: ignore[attr-defined]
    worker.current = "outro-job"
    threading.Timer(0.5, lambda: setattr(worker, "current", None)).start()
    started = time.monotonic()
    events = ask(client, meeting_id, "Resuma")
    assert events[0] == {"type": "status", "message": "Esperando a GPU terminar a tarefa em andamento…"}
    assert time.monotonic() - started >= 0.4
    assert events[-1]["type"] == "done"
    assert not worker.held
