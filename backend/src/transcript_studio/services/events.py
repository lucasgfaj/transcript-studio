"""In-process pub/sub for job progress. The GPU worker thread publishes; SSE handlers subscribe."""
from __future__ import annotations

import queue
import threading
from typing import Any

Event = dict[str, Any]


class JobEvents:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[str, list[queue.Queue[Event]]] = {}
        self._partial: dict[str, list[Event]] = {}  # segments of the running job, for late subscribers
        self._text: dict[str, list[str]] = {}  # streamed minutes text so far

    def subscribe(self, job_id: str) -> tuple[queue.Queue[Event], list[Event], str]:
        """Returns the subscriber queue plus what the running job produced so far (segments, text)."""
        subscriber: queue.Queue[Event] = queue.Queue()
        with self._lock:
            self._subscribers.setdefault(job_id, []).append(subscriber)
            return subscriber, list(self._partial.get(job_id, [])), "".join(self._text.get(job_id, []))

    def unsubscribe(self, job_id: str, subscriber: queue.Queue[Event]) -> None:
        with self._lock:
            subscribers = self._subscribers.get(job_id, [])
            if subscriber in subscribers:
                subscribers.remove(subscriber)
            if not subscribers:
                self._subscribers.pop(job_id, None)

    def publish(self, job_id: str, event: Event) -> None:
        with self._lock:
            if event.get("type") == "segments":
                self._partial.setdefault(job_id, []).extend(event["segments"])
            elif event.get("type") == "token":
                self._text.setdefault(job_id, []).append(event["text"])
            elif event.get("type") in ("done", "error", "cancelled"):
                self._partial.pop(job_id, None)
                self._text.pop(job_id, None)
            targets = list(self._subscribers.get(job_id, []))
        for subscriber in targets:
            subscriber.put(event)
