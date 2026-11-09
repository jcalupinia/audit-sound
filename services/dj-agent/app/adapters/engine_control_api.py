"""Adaptador al motor C++ REAL (Control API, engine/api/control_api.cpp).

Implementado contra el comportamiento VERIFICADO en el código fuente:
  POST /api/login   cuerpo x-www-form-urlencoded: user, pass, name → {"token", "name", "youAreController"}
  POST /api/control/take  (Bearer) → 200 | 409 control_held
  GET  /api/status        (Bearer) → {mode, xfader, state, transition, mixmode, decks[...]}
  GET  /api/tracks        (Bearer) → {"tracks":[{"i","title"}]}   (sin metadatos: brecha B1)
  POST /api/command?action=..&deck=..&value=.. (Bearer; parámetros en la QUERY) → {"ok":true} | 400 | 409

Fase 2 (implementado en el motor): ``/api/tracks`` con metadatos (B1) y cola del agente (B2:
``queue_set/queue_append/queue_remove/queue_clear``, ``GET /api/queue``, ``queue``/``next_source``
en ``/api/status``). Las capacidades se DETECTAN: frente a un motor antiguo el adaptador se degrada
solo (sin metadatos ni cola) en vez de fallar.
Tras el login intenta tomar el control como cuenta de servicio, pero NUNCA lo arrebata a otro
dispositivo vivo (si lo hay, los comandos fallan con control_held y se informa).
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from typing import Any

import httpx

from app.adapters.engine_base import EngineCapabilityError, EngineError, Track
from app.domain.models import DeckOut, EngineSnapshot

_QUERY_KEYS = ("deck", "track", "value", "low", "mid", "high")
_BASE_CAPS = frozenset({"status", "tracks", "commands"})


class ControlApiAdapter:
    name = "control_api"

    def __init__(self, base_url: str, user: str, password: str, *, timeout: float = 3.0,
                 device_name: str = "dj-agent", transport: httpx.BaseTransport | None = None,
                 token_store: tuple[Callable[[], str | None], Callable[[str | None], None]] | None = None):
        if not base_url:
            raise ValueError("DJ_AGENT_ENGINE_URL es obligatorio para el motor real")
        self._client = httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout, transport=transport)
        self._user, self._password, self._device = user, password, device_name
        self._token: str | None = None
        self._lock = threading.Lock()
        self._caps: set[str] | None = None   # detectadas en la primera lectura
        # El motor da el control al primer dispositivo y mantiene viva su sesión 2 h: si el agente
        # se reinicia con un token nuevo, el viejo seguiría controlando. Persistir el token permite
        # reanudar la MISMA sesión tras una caída; close() la libera en un apagado ordenado.
        self._token_store = token_store
        if token_store:
            self._token = token_store[0]() or None

    def capabilities(self) -> set[str]:
        if self._caps is None:
            try:
                self.status()
                self.tracks()
            except EngineError:
                return set(_BASE_CAPS)  # no se cachea: se reintenta cuando el motor vuelva
        return set(self._caps or _BASE_CAPS)

    def _learn(self, cap: str, present: bool) -> None:
        caps = set(self._caps or _BASE_CAPS)
        if present:
            caps.add(cap)
        else:
            caps.discard(cap)
        self._caps = caps

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
        token = str(token)
        try:  # cuenta de servicio: toma el control solo si está libre (el motor responde 409 si no)
            self._client.post("/api/control/take", headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError:
            pass
        return token

    def _ensure_token(self) -> str:
        with self._lock:
            if self._token is None:
                self._token = self._login()
                if self._token_store:
                    self._token_store[1](self._token)
            return self._token

    def close(self) -> None:
        """Apagado ordenado: cierra la sesión con el motor y libera el control (el audio sigue)."""
        with self._lock:
            token, self._token = self._token, None
        if token:
            try:
                self._client.post("/api/logout", headers={"Authorization": f"Bearer {token}"})
            except httpx.HTTPError:
                pass
        if self._token_store:
            self._token_store[1](None)

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
                if self._token_store:
                    self._token_store[1](None)
                continue
            return r
        raise EngineError("engine_auth_failed", "El motor rechazó la sesión")

    # ---------- contrato EngineAdapter ----------
    def status(self) -> EngineSnapshot:
        r = self._request("GET", "/api/status")
        if r.status_code != 200:
            raise EngineError("engine_error", f"/api/status HTTP {r.status_code}")
        j = r.json()
        self._learn("queue", "queue" in j)
        decks = [DeckOut(deck=i, title=str(d.get("title", "")), loaded=bool(d.get("loaded")),
                         playing=bool(d.get("playing")), pos=float(d.get("pos", 0)), dur=float(d.get("dur", 0)),
                         bpm=float(d.get("bpm", 0)), key=int(d.get("key", -1)))
                 for i, d in enumerate(j.get("decks", []))]
        return EngineSnapshot(reachable=True, engine_mode=str(j.get("mode", "auto")), xfader=float(j.get("xfader", 0.5)),
                              automix_state=int(j.get("state", 0)), transition_seconds=float(j.get("transition", 8)),
                              decks=decks, capabilities=sorted(self._caps or _BASE_CAPS),
                              queue=[int(x) for x in j.get("queue", [])], next_source=j.get("next_source"))

    def tracks(self) -> list[Track]:
        r = self._request("GET", "/api/tracks")
        if r.status_code != 200:
            raise EngineError("engine_error", f"/api/tracks HTTP {r.status_code}")
        j = r.json()
        self._learn("metadata", bool(j.get("metadata")))
        out = []
        for t in j.get("tracks", []):
            has = "bpm" in t and float(t.get("bpm") or 0) > 1
            out.append(Track(id=int(t["i"]), title=str(t.get("title", "")),
                             bpm=float(t["bpm"]) if has else None,
                             key=int(t["key"]) if has else None,
                             energy=float(t["energy"]) if has else None,
                             duration=float(t["duration"]) if t.get("duration") else None,
                             genre=str(t["genre"]).strip() or None if t.get("genre") else None))
        return out

    def execute(self, engine_action: str, params: dict[str, Any]) -> dict[str, Any]:
        if engine_action in ("queue_set", "queue_clear"):
            if "queue" not in self.capabilities():
                raise EngineCapabilityError("queue_unsupported",
                                            "Este motor no admite cola del agente (versión anterior a la Fase 2)")
            query: dict[str, Any] = {"action": engine_action}
            if engine_action == "queue_set":
                query["tracks"] = ",".join(str(int(t)) for t in params["track_ids"])
            return self._command(query)
        query = {"action": engine_action}
        query.update({k: v for k, v in params.items() if k in _QUERY_KEYS})
        return self._command(query)

    def set_engine_mode(self, mode: str) -> dict[str, Any]:
        return self._command({"action": "set_mode_dj", "value": mode})

    def _command(self, query: dict[str, Any]) -> dict[str, Any]:
        r = self._request("POST", "/api/command", params=query)
        if r.status_code == 409:
            # Un único intento de tomar el control: el motor solo lo concede si está LIBRE
            # (p. ej. la sesión anterior del agente se cerró). Nunca se arrebata a otro vivo.
            if self._request("POST", "/api/control/take").status_code == 200:
                r = self._request("POST", "/api/command", params=query)
        if r.status_code == 200:
            return r.json()
        if r.status_code == 409:
            raise EngineError("control_held", "El motor está controlado por otro dispositivo")
        if r.status_code == 400:
            raise EngineError("engine_rejected", r.json().get("error", "comando rechazado"))
        raise EngineError("engine_error", f"/api/command HTTP {r.status_code}")
