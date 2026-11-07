"""Contrato del adaptador del motor (el agente nunca habla con el motor por otra vía).

Capacidades:
  status, tracks, commands  → existen en la Control API C++ actual.
  metadata                  → BPM/tono/energía en /api/tracks (brecha B1, Fase 2).
  queue                     → cola del agente con prioridad sobre el Selector (brecha B2, Fase 2).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from app.domain.models import EngineSnapshot


class EngineError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class EngineCapabilityError(EngineError):
    pass


@dataclass(frozen=True)
class Track:
    id: int
    title: str
    bpm: float | None = None
    key: int | None = None        # 0..23 (Camelot interno del motor) o None si no se conoce
    energy: float | None = None   # 0..1
    genre: str | None = None
    duration: float | None = None

    @property
    def has_metadata(self) -> bool:
        return self.bpm is not None and self.key is not None and self.energy is not None


class EngineAdapter(Protocol):
    name: str

    def capabilities(self) -> set[str]: ...

    def status(self) -> EngineSnapshot: ...

    def tracks(self) -> list[Track]: ...

    def execute(self, engine_action: str, params: dict[str, Any]) -> dict[str, Any]: ...

    def set_engine_mode(self, mode: str) -> dict[str, Any]: ...


def verify_effect(action: str, params: dict[str, Any], after: EngineSnapshot, tracks: list[Track]) -> str:
    """Comprueba en el estado leído del motor que la acción tuvo efecto.

    Devuelve el nivel de confirmación: ``state_verified`` (se observó en /status),
    ``engine_ok`` (el motor respondió OK pero el efecto no es observable en /status)
    o ``mismatch`` (el estado contradice la acción → no se reporta como éxito).
    """
    decks = {d.deck: d for d in after.decks}
    if action in ("deck_play", "deck_pause"):
        d = decks.get(params["deck"])
        if d is None:
            return "mismatch"
        return "state_verified" if d.playing == (action == "deck_play") else "mismatch"
    if action == "xfader":
        return "state_verified" if abs(after.xfader - params["value"]) < 0.01 else "mismatch"
    if action == "set_transition":
        return "state_verified" if abs(after.transition_seconds - params["value"]) < 0.05 else "mismatch"
    if action == "deck_load":
        d = decks.get(params["deck"])
        title = next((t.title for t in tracks if t.id == params["track"]), None)
        if d is None or title is None:
            return "mismatch"
        return "state_verified" if d.loaded and d.title == title else "mismatch"
    if action == "queue_set":
        # El AutoMix pudo consumir ya la primera pista: basta con que lo que queda sea el final pedido.
        want = list(params["track_ids"])
        if not after.queue:
            return "engine_ok" if len(want) == 1 else "mismatch"  # la única pista ya entró al plato
        return "state_verified" if want[-len(after.queue):] == after.queue else "mismatch"
    if action == "queue_clear":
        return "state_verified" if not after.queue else "mismatch"
    return "engine_ok"
