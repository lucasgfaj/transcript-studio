"""Live recording: audio arrives in small blocks, utterances are transcribed as soon as the speaker pauses."""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import numpy as np

from transcript_studio.domain.ports import AudioRecorder, TranscribedSegment, Transcriber
from transcript_studio.models import MeetingSource
from transcript_studio.schemas.meeting import MeetingCreate
from transcript_studio.services.documents import TranscriptService
from transcript_studio.services.live_segmenter import SAMPLE_RATE, LiveSegmenter, Utterance, pcm16_to_float
from transcript_studio.services.meetings import MeetingService

_PROMPT_CHARS = 200  # previous text given to Whisper so names and spelling stay consistent
_DEAD_PEAK = 0.002   # below this the input is digital silence, not a quiet room
_DEAD_SECONDS = 4


class LiveSession:
    def __init__(self, meeting_id: str, language: str | None, transcriber: Transcriber, recorder: AudioRecorder,
                 segmenter: LiveSegmenter | None = None) -> None:
        self.meeting_id = meeting_id
        self._language = language
        self._transcriber = transcriber
        self._recorder = recorder
        self._segmenter = segmenter or LiveSegmenter()
        self.segments: list[TranscribedSegment] = []
        self.silent = False           # True while the microphone has been delivering digital silence
        self._quiet_samples = 0

    @property
    def seconds(self) -> float:
        return self._segmenter.total_samples / SAMPLE_RATE

    def push(self, pcm16: bytes) -> list[Utterance]:
        """Called on the event loop for every audio block; cheap (no model work)."""
        samples = pcm16_to_float(pcm16)
        self._recorder.write(samples)
        self._track_silence(samples)
        return self._segmenter.push(samples)

    def _track_silence(self, samples: np.ndarray) -> None:
        """A muted or wrong input device sends near-zero samples (peak ~0.0002); a quiet room never does."""
        if len(samples) and float(np.abs(samples).max()) < _DEAD_PEAK:
            self._quiet_samples += len(samples)
        else:
            self._quiet_samples = 0
        self.silent = self._quiet_samples >= _DEAD_SECONDS * SAMPLE_RATE

    def finish(self) -> list[Utterance]:
        self._recorder.close()
        return self._segmenter.flush()

    def transcribe(self, utterance: Utterance) -> list[TranscribedSegment]:
        """Called on a worker thread, one utterance at a time and in order."""
        prompt = " ".join(s.text for s in self.segments)[-_PROMPT_CHARS:]
        found = self._transcriber.transcribe_samples(utterance.samples, self._language, utterance.start, prompt)
        self.segments.extend(found)
        return found


def start_meeting(meetings: MeetingService, title: str, participants: list[str], language: str | None) -> str:
    data = MeetingCreate(title=title.strip() or "Gravação ao vivo", participants=participants, language=language or "pt")
    return meetings.create(data, source=MeetingSource.live).id


def save_meeting(meetings: MeetingService, transcripts: TranscriptService, session: LiveSession,
                 recording: Path, discard_if_empty: Callable[[], bool] = lambda: True) -> bool:
    """Attaches the recording and the timed transcript. Returns False when nothing was recorded."""
    if session.seconds < 0.5 and discard_if_empty():
        meetings.delete(session.meeting_id)
        recording.unlink(missing_ok=True)
        return False
    meetings.attach_audio(session.meeting_id, "audio.wav", recording)
    recording.unlink(missing_ok=True)
    if session.segments:
        transcripts.set_segments(session.meeting_id, session.segments)
    return True
