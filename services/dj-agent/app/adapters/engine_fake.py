"""Motor SIMULADO para pruebas (no produce audio).

Imita el comportamiento observable del motor C++ con un reloj virtual (``advance``):
dos platos, crossfader, AutoMix con su propio selector (BPM/Camelot/no repetir) y,
opcionalmente, la cola del agente propuesta para la Fase 2.

Es INDEPENDIENTE del agente: si el agente cae, ``advance`` sigue reproduciendo y
transicionando por su cuenta — exactamente la garantía que se exige al motor real.

``emulate_current_engine=True`` reproduce las limitaciones del motor real de hoy:
``/api/tracks`` sin metadatos (B1) y sin cola del agente (B2).
"""

from __future__ import annotations

import threading
from collections import deque
from dataclasses import dataclass
from typing import Any

from app.adapters.engine_base import EngineCapabilityError, EngineError, Track
from app.domain.models import DeckOut, EngineSnapshot
from app.domain.music import bpm_close, keys_compatible


def demo_catalog() -> list[Track]:
    """Catálogo de PRUEBA (títulos ficticios, sin audio). Géneros y metadatos plausibles."""
    rows = [
        ("Prueba House 01", 124, 7, 0.62, "house"), ("Prueba House 02", 125, 8, 0.66, "house"),
        ("Prueba House 03", 126, 7, 0.70, "house"), ("Prueba House 04", 124, 19, 0.58, "house"),
        ("Prueba Deep 01", 120, 19, 0.45, "deep house"), ("Prueba Deep 02", 121, 20, 0.48, "deep house"),
        ("Prueba Techno 01", 130, 21, 0.82, "techno"), ("Prueba Techno 02", 132, 22, 0.88, "techno"),
        ("Prueba Salsa 01", 95, 2, 0.74, "salsa"), ("Prueba Salsa 02", 96, 9, 0.78, "salsa"),
        ("Prueba Salsa 03", 98, 2, 0.81, "salsa"), ("Prueba Salsa 04", 94, 14, 0.69, "salsa"),
        ("Prueba Reggaeton 01", 92, 13, 0.80, "reggaeton"), ("Prueba Reggaeton 02", 94, 14, 0.84, "reggaeton"),
        ("Prueba Reggaeton 03", 96, 13, 0.88, "reggaeton"), ("Prueba Reggaeton 04", 90, 20, 0.76, "reggaeton"),
        ("Prueba Lounge 01", 104, 4, 0.30, "lounge"), ("Prueba Lounge 02", 106, 16, 0.34, "lounge"),
        ("Prueba Lounge 03", 100, 4, 0.28, "lounge"), ("Prueba Pop 01", 116, 0, 0.60, "pop"),
        ("Prueba Pop 02", 118, 7, 0.64, "pop"), ("Prueba Pop 03", 112, 12, 0.55, "pop"),
        ("Prueba Cumbia 01", 100, 5, 0.70, "cumbia"), ("Prueba Cumbia 02", 102, 17, 0.72, "cumbia"),
    ]
    return [Track(id=i, title=t, bpm=float(b), key=k, energy=e, genre=g, duration=180.0)
            for i, (t, b, k, e, g) in enumerate(rows)]


@dataclass
class _Deck:
    track_id: int | None = None
    playing: bool = False
    pos: float = 0.0
    dur: float = 0.0
    bpm: float = 0.0
    key: int = -1
    cue: float = 0.0
    rate: float = 1.0
    gain: float = 1.0
    filter: float = 0.0
    eq: tuple[float, float, float] = (0.0, 0.0, 0.0)


class FakeEngine:
    name = "fake"

    def __init__(self, *, emulate_current_engine: bool = False, catalog: list[Track] | None = None,
                 transition_seconds: float = 8.0, autostart: bool = True):
        self._lock = threading.RLock()
        self.catalog = catalog or demo_catalog()
        self.emulate_current = emulate_current_engine
        self.engine_mode = "auto"
        self.automix = True
        self.xfader = 0.0
        self.transition_seconds = transition_seconds
        self.mixmode = 0
        self.decks = [_Deck(), _Deck()]
        self.queue: deque[int] = deque()
        self.history: list[int] = []
        self.reachable = True
        self._fail_next: dict[str, str] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.load_count = 0
        self.restart_count = 0       # el motor simulado nunca se reinicia por sí mismo
        self.stream_epoch = 1        # cambiaría solo si el stream se reiniciara
        self.audio_seconds = 0.0
        self.silence_seconds = 0.0
        self.transitions = 0
        self._fade: tuple[int, int, float, float] | None = None  # (de, a, restantes, total)
        if autostart and self.catalog:
            self._load(0, self.catalog[0].id)
            self.decks[0].playing = True
            self.history.append(self.catalog[0].id)

    # ---------- controles de prueba ----------
    def set_reachable(self, ok: bool) -> None:
        with self._lock:
            self.reachable = ok

    def fail_next(self, action: str, code: str = "engine_rejected") -> None:
        with self._lock:
            self._fail_next[action] = code

    def count_calls(self, action: str) -> int:
        with self._lock:
            return sum(1 for a, _ in self.calls if a == action)

    # ---------- contrato EngineAdapter ----------
    def capabilities(self) -> set[str]:
        caps = {"status", "tracks", "commands"}
        if not self.emulate_current:
            caps |= {"metadata", "queue"}
        return caps

    def tracks(self) -> list[Track]:
        self._check()
        if self.emulate_current:
            return [Track(id=t.id, title=t.title) for t in self.catalog]
        return list(self.catalog)

    def status(self) -> EngineSnapshot:
        with self._lock:
            self._check()
            decks = []
            for i, d in enumerate(self.decks):
                t = self._track(d.track_id)
                decks.append(DeckOut(deck=i, title=t.title if t else "", track_id=d.track_id,
                                     loaded=d.track_id is not None, playing=d.playing, pos=round(d.pos, 2),
                                     dur=d.dur, bpm=d.bpm, key=d.key))
            return EngineSnapshot(reachable=True, engine_mode=self.engine_mode, xfader=round(self.xfader, 3),
                                  automix_state=(2 if self._fade else 1) if self.automix else 0,
                                  transition_seconds=self.transition_seconds, decks=decks,
                                  capabilities=sorted(self.capabilities()),
                                  queue=list(self.queue) if "queue" in self.capabilities() else [],
                                  next_source=("agent" if self.queue else "selector")
                                  if "queue" in self.capabilities() else None)

    def set_engine_mode(self, mode: str) -> dict[str, Any]:
        with self._lock:
            self._check()
            self.calls.append(("set_mode_dj", {"value": mode}))
            if mode not in ("manual", "auto"):
                raise EngineError("invalid_mode", "Modo de motor no válido")
            self.engine_mode = mode
            self.automix = mode == "auto"
            if mode == "manual":
                # Emula el C++ CORREGIDO en la Fase 2 (control_api.cpp, set_mode_dj): carga solo
                # platos realmente vacíos y centra el crossfader solo si no suena nada.
                # Nunca recarga ni detiene el plato que suena.
                for i, d in enumerate(self.decks):
                    if d.track_id is None and len(self.catalog) > i:
                        self._load(i, self.catalog[i].id)
                if not any(d.playing for d in self.decks):
                    self.xfader = 0.5
                self._fade = None
            return {"ok": True}

    def execute(self, engine_action: str, params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._check()
            self.calls.append((engine_action, dict(params)))
            code = self._fail_next.pop(engine_action, None)
            if code:
                raise EngineError(code, f"El motor simulado rechazó {engine_action}")
            p = params
            if engine_action == "deck_load":
                if self._track(p["track"]) is None:
                    raise EngineError("unknown_track", "Pista inexistente en el catálogo")
                self._load(p["deck"], p["track"])
            elif engine_action == "deck_play":
                d = self.decks[p["deck"]]
                if d.track_id is None:
                    raise EngineError("deck_empty", "El plato no tiene pista cargada")
                d.playing = True
            elif engine_action == "deck_pause":
                self.decks[p["deck"]].playing = False
            elif engine_action == "deck_cue":
                d = self.decks[p["deck"]]
                d.playing, d.pos = False, d.cue
            elif engine_action == "deck_set_cue":
                self.decks[p["deck"]].cue = self.decks[p["deck"]].pos
            elif engine_action == "xfader":
                self.xfader = float(p["value"])
                self._fade = None
            elif engine_action == "eq":
                self.decks[p["deck"]].eq = (p["low"], p["mid"], p["high"])
            elif engine_action == "filter":
                self.decks[p["deck"]].filter = p["value"]
            elif engine_action == "gain":
                self.decks[p["deck"]].gain = p["value"]
            elif engine_action == "rate":
                self.decks[p["deck"]].rate = p["value"]
            elif engine_action == "skip":
                if self.automix:
                    if self._fade:
                        self._finish_fade()   # nunca recarga el plato que ya está entrando
                    else:
                        self._start_transition()
            elif engine_action == "set_transition":
                self.transition_seconds = float(p["value"])
            elif engine_action == "set_mode":
                self.mixmode = int(p["value"])
            elif engine_action in ("queue_set", "queue_clear"):
                if "queue" not in self.capabilities():
                    raise EngineCapabilityError("queue_unsupported", "El motor no admite cola del agente (B2)")
                if engine_action == "queue_clear":
                    self.queue.clear()
                else:
                    for tid in p["track_ids"]:
                        if self._track(tid) is None:
                            raise EngineError("unknown_track", f"Pista inexistente: {tid}")
                    self.queue = deque(p["track_ids"])
            else:
                raise EngineError("unknown_action", "acción desconocida")
            return {"ok": True}

    # ---------- simulación del tiempo (independiente del agente) ----------
    def advance(self, seconds: float, step: float = 0.5) -> None:
        with self._lock:
            t = 0.0
            while t < seconds - 1e-9:
                dt = min(step, seconds - t)
                self._tick(dt)
                t += dt

    def _tick(self, dt: float) -> None:
        for d in self.decks:
            if d.playing:
                d.pos = min(d.dur, d.pos + dt * d.rate)
                if d.pos >= d.dur:
                    d.playing = False
        if self._audible():
            self.audio_seconds += dt
        else:
            self.silence_seconds += dt
        if not self.automix:
            return
        if self._fade:
            src, dst, left, total = self._fade
            left -= dt
            if left <= 0:
                self._finish_fade()
            else:
                progress = 1.0 - left / total          # el crossfader avanza gradualmente
                self.xfader = progress if dst == 1 else 1.0 - progress
                self._fade = (src, dst, left, total)
            return
        on_air = self._on_air()
        if on_air is None:
            # Nada suena en automático: AutoMix arranca la siguiente pista (no se queda en silencio).
            self._start_transition(force_from=None)
            return
        d = self.decks[on_air]
        if d.dur and d.pos >= d.dur - self.transition_seconds:
            self._start_transition()

    def _finish_fade(self) -> None:
        if not self._fade:
            return
        src, dst, _, _ = self._fade
        self.xfader = 1.0 if dst == 1 else 0.0
        self.decks[src].playing = False
        self._fade = None
        self.transitions += 1

    def _audible(self) -> bool:
        a = self.decks[0].playing and self.xfader < 1.0
        b = self.decks[1].playing and self.xfader > 0.0
        return a or b

    def _on_air(self) -> int | None:
        playing = [i for i, d in enumerate(self.decks) if d.playing]
        if not playing:
            return None
        if len(playing) == 1:
            return playing[0]
        return 1 if self.xfader > 0.5 else 0

    def _start_transition(self, force_from: int | None | str = "auto") -> None:
        src = self._on_air() if force_from == "auto" else force_from
        dst = 1 - src if src is not None else 0
        nxt = self._pick_next()
        if nxt is None:
            return
        self._load(dst, nxt)
        self.decks[dst].playing = True
        self.history.append(nxt)
        if src is None:
            self.xfader = 1.0 if dst == 1 else 0.0
            self.transitions += 1
            return
        total = max(0.5, self.transition_seconds)
        self._fade = (src, dst, total, total)

    def _pick_next(self) -> int | None:
        while self.queue:
            tid = self.queue.popleft()
            if self._track(tid) is not None:
                return tid
        cur = self._track(self.history[-1]) if self.history else None
        recent = set(self.history[-6:])
        candidates = [t for t in self.catalog if t.id not in recent] or list(self.catalog)
        if cur is not None:
            good = [t for t in candidates if bpm_close(cur.bpm, t.bpm) and keys_compatible(cur.key, t.key)]
            if good:
                return good[0].id
            near = [t for t in candidates if bpm_close(cur.bpm, t.bpm, 12.0)]
            if near:
                return near[0].id
        return candidates[0].id if candidates else None

    # ---------- utilidades ----------
    def _check(self) -> None:
        if not self.reachable:
            raise EngineError("engine_unreachable", "El motor no responde")

    def _track(self, tid: int | None) -> Track | None:
        if tid is None:
            return None
        return next((t for t in self.catalog if t.id == tid), None)

    def _load(self, deck: int, tid: int) -> None:
        t = self._track(tid)
        assert t is not None
        self.decks[deck] = _Deck(track_id=tid, playing=False, pos=0.0, dur=t.duration or 180.0,
                                 bpm=t.bpm or 0.0, key=t.key if t.key is not None else -1)
        self.load_count += 1
