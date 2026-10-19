"""Single GPU worker: runs jobs strictly one at a time.

Running Whisper and the LLM together on a 6 GB GPU filled the VRAM and made a 10-minute
transcription take more than 10 minutes; serialising GPU work is the main speed-up.
"""
from __future__ import annotations

import logging
import queue
import threading
from collections.abc import Callable
from typing import Protocol

from transcript_studio.models import JobKind

log = logging.getLogger(__name__)


class JobContext:
    def __init__(self, worker: GpuWorker, job_id: str) -> None:
        self._worker = worker
        self.job_id = job_id

    def cancelled(self) -> bool:
        return self._worker.is_cancelled(self.job_id)


class JobHandler(Protocol):
    def run(self, job_id: str, context: JobContext) -> None: ...


class GpuWorker:
    def __init__(self, handlers: dict[JobKind, JobHandler], kind_of: Callable[[str], JobKind | None]) -> None:
        self._handlers = handlers
        self._kind_of = kind_of
        self._queue: queue.Queue[str | Callable[[], None] | None] = queue.Queue()
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._holds = 0
        self._idle = threading.Condition()
        self.current: str | None = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="gpu-worker", daemon=True)
            self._thread.start()

    def stop(self, timeout: float = 5) -> None:
        if self._thread is not None:
            self._queue.put(None)
            self._thread.join(timeout)
            self._thread = None

    def submit(self, job_id: str) -> None:
        self._queue.put(job_id)

    def call_soon(self, task: Callable[[], None]) -> None:
        """Runs a GPU task (e.g. warming up a model) in queue order, without a Job row."""
        self._queue.put(task)

    def cancel(self, job_id: str) -> None:
        with self._lock:
            self._cancelled.add(job_id)

    def is_cancelled(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancelled

    def hold(self) -> None:
        """Live recording owns the GPU: queued jobs wait (the running one finishes) until release()."""
        with self._idle:
            self._holds += 1

    def release(self) -> None:
        with self._idle:
            self._holds = max(0, self._holds - 1)
            self._idle.notify_all()

    @property
    def held(self) -> bool:
        return self._holds > 0

    def pending(self) -> int:
        return self._queue.qsize()

    def _loop(self) -> None:
        while (item := self._queue.get()) is not None:
            if callable(item):
                try:
                    item()
                except Exception:
                    log.exception("GPU task failed")
                continue
            job_id = item
            with self._idle:
                self._idle.wait_for(lambda: self._holds == 0)
            kind = self._kind_of(job_id)
            handler = self._handlers.get(kind) if kind else None
            if handler is None:
                continue
            self.current = job_id
            try:
                handler.run(job_id, JobContext(self, job_id))
            except Exception:  # a broken job must never kill the worker
                log.exception("Job %s failed outside its handler", job_id)
            finally:
                self.current = None
                with self._lock:
                    self._cancelled.discard(job_id)
