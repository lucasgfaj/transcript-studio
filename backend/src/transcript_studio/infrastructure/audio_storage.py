"""Filesystem storage for meeting audio: data/meetings/<id>/audio.<ext>."""
from __future__ import annotations

import mimetypes
import shutil
import tempfile
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

    def clip(self, meeting_id: str, filename: str, start: float, end: float) -> Path:
        """Writes the excerpt to a temporary file (the caller deletes it); the original is untouched."""
        with tempfile.NamedTemporaryFile(prefix="clip-", suffix=Path(filename).suffix, delete=False) as handle:
            target = Path(handle.name)
        clip_audio(self.path(meeting_id, filename), target, start, end)
        return target


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


def clip_audio(source: Path, target: Path, start: float, end: float) -> None:
    """Copies the audio packets between start and end (seconds) into target, without re-encoding.

    Stream copy keeps the original quality and takes seconds even for long meetings; the cut lands
    on the nearest packet boundary (a few milliseconds). The container follows target's extension.
    """
    import av

    try:
        if target.suffix.lower() == ".flac":
            _reencode_flac(source, target, start, end)  # stream copy keeps the old length in STREAMINFO
            return
        with av.open(str(source), metadata_errors="ignore") as reader:
            if not reader.streams.audio:
                raise InvalidAudioError("O arquivo não tem trilha de áudio.")
            stream = reader.streams.audio[0]
            time_base = stream.time_base
            if time_base is None:
                raise InvalidAudioError("Não consegui ler as marcações de tempo do áudio.")
            try:
                reader.seek(int(start / time_base), stream=stream)
            except av.FFmpegError:  # files without an index (browser webm): read from the start
                reader.seek(0, stream=stream)
            with av.open(str(target), "w") as writer:
                output = writer.add_stream_from_template(stream)
                offset: int | None = None
                for packet in reader.demux(stream):
                    timestamp = packet.pts if packet.pts is not None else packet.dts
                    if timestamp is None:
                        continue  # flush packet
                    seconds = float(timestamp * time_base)
                    if seconds < start:
                        continue
                    if seconds >= end:
                        break
                    if offset is None:
                        offset = timestamp
                    if packet.pts is not None:
                        packet.pts -= offset
                    if packet.dts is not None:
                        packet.dts = max(packet.dts - offset, 0)
                    packet.stream = output
                    writer.mux(packet)
                if offset is None:
                    raise InvalidAudioError("Esse trecho não tem áudio.")
    except InvalidAudioError:
        target.unlink(missing_ok=True)
        raise
    except Exception as error:  # PyAV raises many specific error types
        target.unlink(missing_ok=True)
        raise InvalidAudioError(f"Não consegui cortar o áudio: {error}") from error


def _reencode_flac(source: Path, target: Path, start: float, end: float) -> None:
    """FLAC is lossless, so decoding and encoding the excerpt again loses nothing."""
    import av

    with av.open(str(source), metadata_errors="ignore") as reader:
        stream = reader.streams.audio[0]
        rate = stream.rate
        first, last = round(start * rate), round(end * rate)
        with av.open(str(target), "w") as writer:
            output = writer.add_stream("flac", rate=rate, layout=stream.layout.name, format=stream.format.name)
            position, written = 0, 0
            for frame in reader.decode(stream):
                if frame.pts is not None and frame.time_base is not None:
                    position = round(float(frame.pts * frame.time_base) * rate)
                frame_end = position + frame.samples
                if frame_end > first and position < last:
                    samples = frame.to_ndarray()
                    step = 1 if frame.format.is_planar else len(frame.layout.channels)  # packed = interleaved
                    keep = samples[..., max(first - position, 0) * step:(min(last, frame_end) - position) * step]
                    piece = av.AudioFrame.from_ndarray(keep, format=frame.format.name, layout=frame.layout.name)
                    piece.sample_rate, piece.pts = rate, written
                    written += piece.samples
                    for packet in output.encode(piece):
                        writer.mux(packet)
                position = frame_end
                if position >= last:
                    break
            for packet in output.encode(None):
                writer.mux(packet)
    if not written:
        raise InvalidAudioError("Esse trecho não tem áudio.")
