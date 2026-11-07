"""Bus de eventos en proceso: persiste (auditoría + replay) y reparte a suscriptores WS.

Cada evento tiene ``sequence`` monótona por sesión. Un suscriptor que se retrasa
(cola llena) recibe ``resync_required`` y debe pedir un snapshot nuevo: así nunca
recibe una secuencia con huecos sin saberlo.
"""

from __future__ import annotations

import asyncio
import threading
from typing import Any

from app.persistence.store import Store

QUEUE_MAX = 1000


class EventBus:
    def __init__(self, store: Store):
        self.store = store
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, session_id: str, type_: str, payload: dict[str, Any], *, correlation_id: str | None = None,
                source: str = "agent", status: str | None = None, actor_id: str | None = None) -> dict[str, Any]:
        ev = self.store.append_event(session_id, type_, payload, correlation_id=correlation_id, source=source,
                                     status=status, actor_id=actor_id)
        with self._lock:
            queues = list(self._subs.get(session_id, ()))
        for q in queues:
            self._deliver(q, ev)
        return ev

    def _deliver(self, q: asyncio.Queue, ev: dict[str, Any]) -> None:
        def put() -> None:
            if q.full():
                try:
                    while not q.empty():
                        q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
                q.put_nowait({"type": "resync_required", "sequence": ev["sequence"], "session_id": ev["session_id"]})
            else:
                q.put_nowait(ev)

        loop = self._loop
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if loop is not None and running is not loop:
            loop.call_soon_threadsafe(put)
        else:
            put()

    def subscribe(self, session_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
        with self._lock:
            self._subs.setdefault(session_id, set()).add(q)
        return q

    def unsubscribe(self, session_id: str, q: asyncio.Queue) -> None:
        with self._lock:
            self._subs.get(session_id, set()).discard(q)

    def subscriber_count(self, session_id: str) -> int:
        with self._lock:
            return len(self._subs.get(session_id, ()))
