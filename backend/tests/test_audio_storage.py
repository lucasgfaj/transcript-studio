"""Audio files on disk and the meeting audio rules built on them."""
from __future__ import annotations

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from transcript_studio.domain.errors import InvalidAudioError
from transcript_studio.infrastructure.audio_storage import FileAudioStorage, probe_duration
from tests.conftest import make_wav


def test_saves_from_upload_or_path_and_replaces_the_old_file(tmp_path: Path) -> None:
    storage = FileAudioStorage(tmp_path)
    first = storage.save("m1", "reuniao.WAV", io.BytesIO(make_wav(1.0)))
    source = tmp_path / "outra.flac"
    source.write_bytes(make_wav(2.0))  # content is wav, the extension only names the stored file

    second = storage.save("m1", "outra.flac", source)

    assert (first.filename, first.mime) == ("audio.wav", "audio/x-wav")
    assert second.filename == "audio.flac" and round(second.duration) == 2
    assert sorted(p.name for p in (tmp_path / "m1").iterdir()) == ["audio.flac"]


def test_rejects_unsupported_extension(tmp_path: Path) -> None:
    with pytest.raises(InvalidAudioError, match="Formato não suportado"):
        FileAudioStorage(tmp_path).save("m1", "notas.txt", io.BytesIO(b"oi"))


def test_broken_audio_leaves_nothing_behind(tmp_path: Path) -> None:
    storage = FileAudioStorage(tmp_path)
    storage.save("m1", "a.wav", io.BytesIO(make_wav(1.0)))

    with pytest.raises(InvalidAudioError):
        storage.save("m1", "b.mp3", io.BytesIO(b"isto nao e audio"))

    assert sorted(p.name for p in (tmp_path / "m1").iterdir()) == ["audio.wav"]  # old audio kept, no .part


def test_delete_tolerates_missing_files(tmp_path: Path) -> None:
    storage = FileAudioStorage(tmp_path)
    path = storage.path("m1", "audio.wav")
    storage.delete("m1", "audio.wav")  # missing file: no error
    storage.save("m1", "a.wav", io.BytesIO(make_wav(0.5)))
    storage.delete("m1", "audio.wav")
    assert not path.exists()
    storage.delete_all("m1")
    assert not (tmp_path / "m1").exists()


def test_probe_rejects_empty_or_missing_audio(tmp_path: Path) -> None:
    empty = tmp_path / "vazio.wav"
    empty.write_bytes(make_wav(0.0))
    with pytest.raises(InvalidAudioError):
        probe_duration(empty)
    with pytest.raises(InvalidAudioError, match="Não consegui ler"):
        probe_duration(tmp_path / "nao-existe.wav")


def create(client: TestClient) -> str:
    return client.post("/api/meetings", json={"title": "Áudio"}).json()["id"]


def test_meeting_audio_lifecycle(client: TestClient) -> None:
    meeting_id = create(client)
    assert client.get(f"/api/meetings/{meeting_id}/audio").status_code == 404
    assert client.get(f"/api/meetings/{meeting_id}/audio/peaks").status_code == 404

    client.put(f"/api/meetings/{meeting_id}/audio", files={"file": ("a.wav", make_wav(1.0), "audio/wav")})
    replaced = client.put(f"/api/meetings/{meeting_id}/audio", files={"file": ("b.ogg", make_wav(1.0), "audio/ogg")}).json()
    assert replaced["status"] == "audio_ready"
    assert client.get(f"/api/meetings/{meeting_id}/audio/peaks").status_code == 200

    removed = client.delete(f"/api/meetings/{meeting_id}/audio").json()
    assert removed["status"] == "draft" and not removed["has_audio"]
    assert client.get(f"/api/meetings/{meeting_id}/audio").status_code == 404


def test_update_cleans_participants(client: TestClient) -> None:
    meeting_id = create(client)
    updated = client.patch(f"/api/meetings/{meeting_id}", json={"participants": [" Ana ", "", "Bruno"]}).json()
    assert updated["participants"] == ["Ana", "Bruno"]
