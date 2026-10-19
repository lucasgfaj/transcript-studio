"""Filesystem storage for meeting audio: data/meetings/<id>/audio.<ext>."""
from __future__ import annotations

import mimetypes
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from transcript_studio.domain.errors import InvalidAudioError

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".ogg", ".oga", ".opus", ".webm", ".flac", ".aac", ".mp4", ".mkv"}
_CHUNK = 1024 * 1024


@dataclass(frozen=True)
class StoredAudioFile:
    filename: str
    size: int
    duration: float
    mime: str


class FileAudioStorage:
    def __init__(self, root: Path) -> None:
        self._root = root

    def save(self, meeting_id: str, original_name: str, source: BinaryIO | Path) -> StoredAudioFile:
        extension = Path(original_name).suffix.lower() or ".wav"
        if extension not in AUDIO_EXTENSIONS:
            raise InvalidAudioError(f"Formato não suportado: {extension}. Use {', '.join(sorted(AUDIO_EXTENSIONS))}.")
        directory = self._root / meeting_id
        directory.mkdir(parents=True, exist_ok=True)
        filename = f"audio{extension}"
        partial = directory / f".{filename}.part"
        if isinstance(source, Path):
            shutil.copyfile(source, partial)
        else:
            with partial.open("wb") as output:
                shutil.copyfileobj(source, output, _CHUNK)
        try:
            duration = probe_duration(partial)
        except InvalidAudioError:
            partial.unlink(missing_ok=True)
            raise
        for old in directory.glob("audio.*"):
            old.unlink()
        final = directory / filename
        partial.replace(final)
        mime = "audio/webm" if extension == ".webm" else mimetypes.guess_type(final.name)[0] or "application/octet-stream"
        return StoredAudioFile(filename, final.stat().st_size, duration, mime)

    def path(self, meeting_id: str, filename: str) -> Path:
        return self._root / meeting_id / filename

    def delete(self, meeting_id: str, filename: str) -> None:
        self.path(meeting_id, filename).unlink(missing_ok=True)

    def delete_all(self, meeting_id: str) -> None:
        shutil.rmtree(self._root / meeting_id, ignore_errors=True)


def probe_duration(path: Path) -> float:
    """Duration in seconds via PyAV; walks the packets when the header has none (browser webm)."""
    import av

    try:
        with av.open(str(path), metadata_errors="ignore") as container:
            if not container.streams.audio:
                raise InvalidAudioError("O arquivo não tem trilha de áudio.")
            if container.duration:
                return container.duration / 1_000_000
            stream = container.streams.audio[0]
            last = 0.0
            for packet in container.demux(stream):
                if packet.pts is not None and packet.time_base is not None:
                    last = max(last, float((packet.pts + (packet.duration or 0)) * packet.time_base))
    except InvalidAudioError:
        raise
    except Exception as error:  # PyAV raises many specific error types
        raise InvalidAudioError(f"Não consegui ler o áudio: {error}") from error
    if last <= 0:
        raise InvalidAudioError("Áudio vazio.")
    return last
