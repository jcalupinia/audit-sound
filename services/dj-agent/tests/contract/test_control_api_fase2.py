"""Contrato Fase 2 del adaptador: metadatos (B1), cola (B2) y degradación frente a un motor antiguo."""

from __future__ import annotations

import httpx
import pytest

from app.adapters.engine_base import EngineCapabilityError, verify_effect
from app.adapters.engine_control_api import ControlApiAdapter


class Cpp2:
    """Reproduce la Control API de la Fase 2 (engine/api/control_api.cpp)."""

    def __init__(self):
        self.queue: list[int] = []
        self.requests: list[httpx.Request] = []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        p = req.url.path
        if p == "/api/login":
            return httpx.Response(200, json={"token": "t1", "name": "dj-agent", "youAreController": True})
        if p == "/api/control/take":
            return httpx.Response(200, json={"ok": True})
        if p == "/api/tracks":
            return httpx.Response(200, json={"metadata": True, "tracks": [
                {"i": 0, "title": "A", "bpm": 124.0, "key": 7, "energy": 0.6, "duration": 183.4},
                {"i": 1, "title": "B", "bpm": 126.0, "key": 8, "energy": 0.7, "duration": 200.0}]})
        if p == "/api/status":
            return httpx.Response(200, json={"mode": "auto", "xfader": 0.0, "state": 1, "transition": 8, "mixmode": 0,
                                             "decks": [{"title": "A", "loaded": 1, "playing": 1, "pos": 3, "dur": 183,
                                                        "bpm": 124, "key": 7}],
                                             "queue": self.queue, "next_source": "agent" if self.queue else "selector"})
        if p == "/api/command":
            q = req.url.params
            if q["action"] == "queue_set":
                self.queue = [int(x) for x in q["tracks"].split(",")]
            elif q["action"] == "queue_clear":
                self.queue = []
            return httpx.Response(200, json={"ok": True, "queue": self.queue})
        return httpx.Response(404)


@pytest.fixture
def cpp():
    return Cpp2()


@pytest.fixture
def adapter(cpp):
    return ControlApiAdapter("http://engine:8787", "agente", "clave", transport=httpx.MockTransport(cpp))


def test_detecta_capacidades_y_lee_metadatos(adapter):
    assert {"metadata", "queue"} <= adapter.capabilities()
    a, b = adapter.tracks()
    assert a.has_metadata and (a.bpm, a.key, a.energy, a.duration) == (124.0, 7, 0.6, 183.4) and b.bpm == 126.0


def test_toma_el_control_tras_el_login(adapter, cpp):
    adapter.status()
    assert [r.url.path for r in cpp.requests[:3]] == ["/api/login", "/api/control/take", "/api/status"]
    assert "pass=clave" in cpp.requests[0].content.decode() and "clave" not in str(cpp.requests[0].url)


def test_cola_se_envia_como_lista_y_se_verifica_en_el_estado(adapter, cpp):
    adapter.execute("queue_set", {"track_ids": [1, 0]})
    sent = cpp.requests[-1]
    assert sent.url.params["action"] == "queue_set" and sent.url.params["tracks"] == "1,0"
    snap = adapter.status()
    assert snap.queue == [1, 0] and snap.next_source == "agent"
    assert verify_effect("queue_set", {"track_ids": [1, 0]}, snap, []) == "state_verified"
    adapter.execute("queue_clear", {})
    assert verify_effect("queue_clear", {}, adapter.status(), []) == "state_verified"


def test_verificacion_tolera_que_el_automix_consuma_la_primera(adapter, cpp):
    cpp.queue = [0]                                    # el motor ya tomó la pista 1
    assert verify_effect("queue_set", {"track_ids": [1, 0]}, adapter.status(), []) == "state_verified"
    cpp.queue = [5]
    assert verify_effect("queue_set", {"track_ids": [1, 0]}, adapter.status(), []) == "mismatch"


def test_motor_antiguo_se_degrada_sin_fallar():
    def old(req: httpx.Request) -> httpx.Response:
        if req.url.path == "/api/login":
            return httpx.Response(200, json={"token": "t"})
        if req.url.path == "/api/tracks":
            return httpx.Response(200, json={"tracks": [{"i": 0, "title": "A"}]})
        if req.url.path == "/api/status":
            return httpx.Response(200, json={"mode": "auto", "decks": []})
        return httpx.Response(200, json={"ok": True})

    ad = ControlApiAdapter("http://e", "u", "p", transport=httpx.MockTransport(old))
    assert ad.capabilities() == {"status", "tracks", "commands"}
    assert not ad.tracks()[0].has_metadata
    with pytest.raises(EngineCapabilityError):
        ad.execute("queue_set", {"track_ids": [0]})
