"""Adaptador al motor C++ REAL (Control API, engine/api/control_api.cpp).

Implementado contra el comportamiento VERIFICADO en el código fuente:
  POST /api/login   cuerpo x-www-form-urlencoded: user, pass, name → {"token", "name", "youAreController"}
  POST /api/control/take  (Bearer) → 200 | 409 control_held
  GET  /api/status        (Bearer) → {mode, xfader, state, transition, mixmode, decks[...]}
  GET  /api/tracks        (Bearer) → {"tracks":[{"i","title"}]}   (sin metadatos: brecha B1)
  POST /api/command?action=..&deck=..&value=.. (Bearer; parámetros en la QUERY) → {"ok":true} | 400 | 409

En Fase 1 se prueba con un transporte simulado que reproduce ese contrato; la prueba
contra el binario real es de la Fase 2. La cola del agente (B2) aún no existe → error de capacidad.
El adaptador NO arrebata el control a otro dispositivo (si hay controlador vivo, falla con control_held).
"""

from __future__ import annotations

import threading
from typing import Any

import httpx

from app.adapters.engine_base import EngineCapabilityError, EngineError, Track
from app.domain.models import DeckOut, EngineSnapshot

_QUERY_KEYS = ("deck", "track", "value", "low", "mid", "high")


class ControlApiAdapter:
    name = "control_api"

    def __init__(self, base_url: str, user: str, password: str, *, timeout: float = 3.0,
                 device_name: str = "dj-agent", transport: httpx.BaseTransport | None = None):
        if not base_url:
            raise ValueError("DJ_AGENT_ENGINE_URL es obligatorio para el motor real")
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport)
        self._user, self._password, self._device = user, password, device_name
        self._token: str | None = None
        self._lock = threading.Lock()

    def capabilities(self) -> set[str]:
        return {"status", "tracks", "commands"}

    # ---------- sesión con la Control API ----------
    def _login(self) -> str:
        try:
            r = self._client.post("/api/login", data={"user": self._user, "pass": self._password,
                                                      "name": self._device})
        except httpx.TimeoutException as exc:
            raise EngineError("engine_timeout", "El motor no respondió a tiempo") from exc
        except httpx.TransportError as exc:
            raise EngineError("engine_unreachable", "No se pudo conectar con el motor") from exc
        if r.status_code == 401:
            raise EngineError("engine_auth_failed", "Credenciales del motor rechazadas")
        if r.status_code == 429:
            raise EngineError("engine_rate_limited", "El motor limitó los intentos de login")
        if r.status_code != 200:
            raise EngineError("engine_error", f"Login del motor: HTTP {r.status_code}")
        token = r.json().get("token")
        if not token:
            raise EngineError("engine_error", "El motor no devolvió token")
        return str(token)

    def _ensure_token(self) -> str:
        with self._lock:
            if self._token is None:
                self._token = self._login()
            return self._token

    def take_control(self) -> None:
        r = self._request("POST", "/api/control/take")
        if r.status_code == 409:
            raise EngineError("control_held", "Otro dispositivo controla el motor; no se arrebata el control")

    def _request(self, method: str, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        for attempt in (1, 2):
            token = self._ensure_token()
            try:
                r = self._client.request(method, path, params=params, headers={"Authorization": f"Bearer {token}"})
            except httpx.TimeoutException as exc:
                raise EngineError("engine_timeout", "El motor no respondió a tiempo") from exc
            except httpx.TransportError as exc:
                raise EngineError("engine_unreachable", "No se pudo conectar con el motor") from exc
            if r.status_code == 401 and attempt == 1:
                with self._lock:
                    self._token = None  # token revocado o caducado: un único re-login
                continue
            return r
        raise EngineError("engine_auth_failed", "El motor rechazó la sesión")

    # ---------- contrato EngineAdapter ----------
    def status(self) -> EngineSnapshot:
        r = self._request("GET", "/api/status")
        if r.status_code != 200:
            raise EngineError("engine_error", f"/api/status HTTP {r.status_code}")
        j = r.json()
        decks = [DeckOut(deck=i, title=str(d.get("title", "")), loaded=bool(d.get("loaded")),
                         playing=bool(d.get("playing")), pos=float(d.get("pos", 0)), dur=float(d.get("dur", 0)),
                         bpm=float(d.get("bpm", 0)), key=int(d.get("key", -1)))
                 for i, d in enumerate(j.get("decks", []))]
        return EngineSnapshot(reachable=True, engine_mode=str(j.get("mode", "auto")), xfader=float(j.get("xfader", 0.5)),
                              automix_state=int(j.get("state", 0)), transition_seconds=float(j.get("transition", 8)),
                              decks=decks, capabilities=sorted(self.capabilities()))

    def tracks(self) -> list[Track]:
        r = self._request("GET", "/api/tracks")
        if r.status_code != 200:
            raise EngineError("engine_error", f"/api/tracks HTTP {r.status_code}")
        return [Track(id=int(t["i"]), title=str(t.get("title", ""))) for t in r.json().get("tracks", [])]

    def execute(self, engine_action: str, params: dict[str, Any]) -> dict[str, Any]:
        if engine_action in ("queue_set", "queue_clear"):
            raise EngineCapabilityError("queue_unsupported",
                                        "El motor actual no admite cola del agente (brecha B2, Fase 2)")
        query = {"action": engine_action}
        query.update({k: v for k, v in params.items() if k in _QUERY_KEYS})
        return self._command(query)

    def set_engine_mode(self, mode: str) -> dict[str, Any]:
        return self._command({"action": "set_mode_dj", "value": mode})

    def _command(self, query: dict[str, Any]) -> dict[str, Any]:
        r = self._request("POST", "/api/command", params=query)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 409:
            raise EngineError("control_held", "El motor está controlado por otro dispositivo")
        if r.status_code == 400:
            raise EngineError("engine_rejected", r.json().get("error", "comando rechazado"))
        raise EngineError("engine_error", f"/api/command HTTP {r.status_code}")
