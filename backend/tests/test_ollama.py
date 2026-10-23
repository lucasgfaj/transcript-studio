"""OllamaChat and OllamaClient against a fake Ollama HTTP server (no real Ollama needed)."""
from __future__ import annotations

import json
import threading
from collections.abc import Callable, Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import pytest

from transcript_studio.domain.ports import GenerationCancelled
from transcript_studio.infrastructure.ollama_chat import OllamaChat, OllamaError
from transcript_studio.infrastructure.ollama_client import OllamaClient

# (method, path, json body) -> (status, list of response lines or a dict)
Route = Callable[[str, str, dict[str, Any]], tuple[int, Any]]


class FakeOllama:
    def __init__(self) -> None:
        self.requests: list[tuple[str, str, dict[str, Any]]] = []
        self.route: Route = lambda method, path, body: (404, {"error": "no route"})


@pytest.fixture
def ollama() -> Iterator[tuple[FakeOllama, str]]:
    fake = FakeOllama()

    class Handler(BaseHTTPRequestHandler):
        def _answer(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            fake.requests.append((self.command, self.path, body))
            status, payload = fake.route(self.command, self.path, body)
            data = ("".join(json.dumps(line) + "\n" for line in payload) if isinstance(payload, list)
                    else json.dumps(payload)).encode()
            self.send_response(status)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_DELETE = _answer

        def log_message(self, *args: object) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, args=(0.02,), daemon=True)
    thread.start()
    yield fake, f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def words(*pieces: str) -> list[dict[str, Any]]:
    return [{"message": {"content": piece}} for piece in pieces] + [{"done": True}]


def test_streams_the_answer_with_local_options(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (200, words("Bom ", "dia."))

    pieces = list(OllamaChat(url, context_tokens=4096).stream("qwen", "sistema", "pergunta", max_tokens=50))

    assert pieces == ["Bom ", "dia."]
    method, path, body = fake.requests[0]
    assert (method, path) == ("POST", "/api/chat")
    assert body["think"] is False and body["stream"] is True
    assert body["options"]["num_ctx"] == 4096 and body["options"]["num_predict"] == 50
    assert body["messages"] == [{"role": "system", "content": "sistema"}, {"role": "user", "content": "pergunta"}]


def test_hides_reasoning_split_across_chunks(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (200, words("Oi ", "<think>pensando", " mais</think>", "resposta"))

    assert "".join(OllamaChat(url).stream("qwen", "s", "p")) == "Oi resposta"


def test_retries_without_think_for_models_that_reject_it(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (
        (400, {"error": "model does not support think"}) if "think" in body else (200, words("ok"))
    )
    chat = OllamaChat(url)

    assert list(chat.stream("velho", "s", "p")) == ["ok"]
    assert list(chat.stream("velho", "s", "p")) == ["ok"]
    assert ["think" in body for _m, _p, body in fake.requests] == [True, False, False]  # remembered


def test_missing_model_explains_how_to_install(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (404, {"error": "model 'xyz' not found"})

    with pytest.raises(RuntimeError, match="ollama pull xyz"):
        list(OllamaChat(url).stream("xyz", "s", "p"))


def test_other_http_errors_keep_status_and_body(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (500, {"error": "out of memory"})

    with pytest.raises(OllamaError) as raised:
        list(OllamaChat(url).stream("qwen", "s", "p"))
    assert raised.value.status == 500 and "out of memory" in raised.value.body


def test_error_inside_the_stream(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (200, [{"message": {"content": "a"}}, {"error": "falhou no meio"}])

    with pytest.raises(OllamaError, match="falhou no meio"):
        list(OllamaChat(url).stream("qwen", "s", "p"))


def test_stop_cancels_the_stream(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (200, words("a", "b", "c"))

    with pytest.raises(GenerationCancelled):
        list(OllamaChat(url).stream("qwen", "s", "p", should_stop=lambda: True))


def test_offline_ollama_gives_a_clear_message(offline_url: str) -> None:
    with pytest.raises(RuntimeError, match="Ele está aberto"):
        list(OllamaChat(offline_url, timeout=2).stream("qwen", "s", "p"))


def test_client_reads_version_models_and_loaded(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    answers = {
        "/api/version": {"version": "0.12.0"},
        "/api/tags": {"models": [{"name": "qwen"}, {"name": "llama"}]},
        "/api/ps": {"models": [{"name": "qwen", "size_vram": 10}]},
    }
    fake.route = lambda method, path, body: (200, answers[path])
    client = OllamaClient(url)

    assert client.version() == "0.12.0"
    assert [m["name"] for m in client.list_models()] == ["qwen", "llama"]
    assert client.loaded_models() == ["qwen"]


def test_client_version_is_none_when_offline(offline_url: str) -> None:
    assert OllamaClient(offline_url).version() is None


def test_client_pulls_with_progress_and_deletes(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (
        (200, [{"status": "downloading", "total": 2, "completed": 1}, {"status": "success"}]) if path == "/api/pull"
        else (200, {})
    )
    client = OllamaClient(url)

    assert [p["status"] for p in client.pull("qwen")] == ["downloading", "success"]
    client.delete("qwen")
    assert fake.requests[0][1:] == ("/api/pull", {"model": "qwen", "stream": True})
    assert fake.requests[1] == ("DELETE", "/api/delete", {"model": "qwen"})


def test_release_gpu_unloads_every_loaded_model(ollama: tuple[FakeOllama, str]) -> None:
    fake, url = ollama
    fake.route = lambda method, path, body: (
        (200, {"models": [{"name": "a"}, {"name": "b"}]}) if path == "/api/ps" else (200, {})
    )

    OllamaClient(url).release_gpu()

    unloads = [body for method, path, body in fake.requests if path == "/api/generate"]
    assert unloads == [{"model": "a", "keep_alive": 0}, {"model": "b", "keep_alive": 0}]


def test_release_gpu_ignores_offline_ollama(offline_url: str) -> None:
    OllamaClient(offline_url).release_gpu()  # must not raise: transcription works without Ollama
