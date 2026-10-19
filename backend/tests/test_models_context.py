from __future__ import annotations

import json
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from transcript_studio.core.config import Settings
from transcript_studio.domain.errors import ConflictError
from transcript_studio.services.llm_models import LlmModelService
from tests.conftest import FakeTranscriber

GB = 1024 ** 3


class FakeOllama:
    def __init__(self) -> None:
        self.deleted: list[str] = []

    def list_models(self) -> list[dict[str, Any]]:
        return [
            {"name": "qwen3.5:4b", "size": int(3.3 * GB), "details": {"parameter_size": "4.2B", "quantization_level": "Q4_K_M"}},
            {"name": "qwen3:8b", "size": int(5.2 * GB), "details": {"parameter_size": "8.2B"}},
            {"name": "nomic-embed-text", "size": 300},
        ]

    def running(self) -> list[dict[str, Any]]:
        return [{"name": "qwen3.5:4b", "size_vram": int(3.9 * GB)}]

    def pull(self, name: str) -> Iterator[dict[str, Any]]:
        if name == "nao-existe":
            yield {"error": "pull model manifest: file does not exist"}
            return
        yield {"status": "pulling manifest"}
        yield {"status": "downloading", "total": 200, "completed": 50}
        yield {"status": "success"}

    def delete(self, name: str) -> None:
        self.deleted.append(name)


def test_installed_models_know_what_fits_the_gpu() -> None:
    service = LlmModelService(FakeOllama(), gpu_memory_gb=6.0)
    models = {m.name: m for m in service.installed()}
    assert set(models) == {"qwen3.5:4b", "qwen3:8b"}  # embedding models are hidden
    assert models["qwen3.5:4b"].fits_gpu is True and models["qwen3.5:4b"].loaded is True
    assert models["qwen3:8b"].fits_gpu is False
    catalog = {c.name: c for c in service.catalog(list(models.values()))}
    assert catalog["qwen3.5:4b"].installed and not catalog["gemma3:4b"].installed


def test_pull_progress_and_errors_are_normalised() -> None:
    service = LlmModelService(FakeOllama(), 6.0)
    events = list(service.pull("gemma3:4b"))
    assert events[1]["percent"] == 25.0 and events[-1]["status"] == "success"
    assert list(service.pull("nao-existe")) == [{"error": "pull model manifest: file does not exist"}]


def test_default_model_cannot_be_deleted() -> None:
    ollama = FakeOllama()
    service = LlmModelService(ollama, 6.0)
    with pytest.raises(ConflictError):
        service.delete("qwen3.5:4b", default_llm="qwen3.5:4b")
    service.delete("qwen3:8b", default_llm="qwen3.5:4b")
    assert ollama.deleted == ["qwen3:8b"]


def test_preferences_override_defaults_and_switch_whisper(client: TestClient, transcriber: FakeTranscriber) -> None:
    assert client.get("/api/preferences").json() == {"default_llm": "qwen3.5:4b", "whisper_model": "large-v3-turbo",
                                                      "context_max_chars": 4000}
    updated = client.put("/api/preferences", json={"default_llm": "gemma3:4b", "whisper_model": "small"}).json()
    assert updated["default_llm"] == "gemma3:4b" and updated["whisper_model"] == "small"
    deadline = time.monotonic() + 3
    while transcriber.model_name != "small" and time.monotonic() < deadline:
        time.sleep(0.02)
    assert transcriber.model_name == "small"
    assert client.put("/api/preferences", json={"whisper_model": "gigante"}).status_code == 409
    assert client.put("/api/preferences", json={"context_max_chars": 50}).status_code == 409

    # The new default is what minutes generation uses.
    meeting = client.post("/api/meetings", json={"title": "x"}).json()
    client.put(f"/api/meetings/{meeting['id']}/transcript", json={"text": "algo"})
    job = client.post(f"/api/meetings/{meeting['id']}/minutes/generate").json()
    assert job["params"]["model"] == "gemma3:4b"


def test_models_overview_when_ollama_is_offline(client: TestClient) -> None:
    body = client.get("/api/models").json()
    assert body["available"] is False and body["models"] == []
    assert [w["name"] for w in body["whisper"]][0] == "large-v3-turbo"
    assert any(w["active"] for w in body["whisper"])
    assert body["catalog"][0]["name"] == "qwen3.5:4b"


def test_pull_streams_ndjson_error_when_ollama_is_offline(client: TestClient) -> None:
    lines = [json.loads(line) for line in client.post("/api/models/pull", json={"name": "gemma3:4b"}).text.splitlines()]
    assert "error" in lines[-1]


def test_context_crud_and_budget(client: TestClient, settings: Settings) -> None:
    assert client.put("/api/context/file", params={"path": "glossario.md"}, json={"content": "VGV = valor geral"}).status_code == 200
    client.put("/api/context/file", params={"path": "pessoas/ana.md"}, json={"content": "Ana: diretora financeira"})
    client.put("/api/context/file", params={"path": "README.md"}, json={"content": "sobre a pasta"})
    client.put("/api/context/file", params={"path": "grande.md"}, json={"content": "x" * 5000})

    overview = client.get("/api/context").json()
    files = {f["path"]: f for f in overview["files"]}
    assert files["glossario.md"]["included"] and files["pessoas/ana.md"]["included"]
    assert files["README.md"]["included"] is False
    assert files["grande.md"]["included"] is False and files["grande.md"]["reason"] == "não coube no limite"
    assert 0 < overview["used_chars"] <= overview["max_chars"] == 4000

    client.put("/api/preferences", json={"context_max_chars": 12000})
    assert {f["path"]: f for f in client.get("/api/context").json()["files"]}["grande.md"]["included"]

    assert client.get("/api/context/file", params={"path": "pessoas/ana.md"}).json()["content"] == "Ana: diretora financeira\n"
    assert client.delete("/api/context/file", params={"path": "pessoas/ana.md"}).status_code == 204
    assert not (settings.context_dir / "pessoas").exists()
    assert client.get("/api/context/file", params={"path": "../../etc/passwd.md"}).status_code == 409
    assert client.put("/api/context/file", params={"path": "notas.txt"}, json={"content": "x"}).status_code == 409
