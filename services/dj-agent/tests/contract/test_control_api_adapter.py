"""Contrato del adaptador real contra un transporte que reproduce engine/api/control_api.cpp.

Verifica la forma de las peticiones que recibiría el binario C++ (no se conecta al motor real:
eso es la Fase 2).
"""

from __future__ import annotations

from urllib.parse import parse_qs

import httpx
import pytest

from app.adapters.engine_base import EngineCapabilityError, EngineError
from app.adapters.engine_control_api import ControlApiAdapter


class FakeCpp:
    """Imita las respuestas documentadas de la Control API."""

    def __init__(self):
        self.tokens, self.requests, self.controller = set(), [], None
        self.revoke_next = False

    def __call__(self, req: httpx.Request) -> httpx.Response:
        self.requests.append(req)
        path = req.url.path
        if path == "/api/login":
            form = parse_qs(req.content.decode())
            if form.get("user") != ["agente"] or form.get("pass") != ["clave"]:
                return httpx.Response(401, json={"error": "credenciales inválidas"})
            tok = f"t{len(self.tokens) + 1}"
            self.tokens.add(tok)
            return httpx.Response(200, json={"token": tok, "name": form["name"][0], "youAreController": True})
        auth = req.headers.get("Authorization", "")
        tok = auth[7:] if auth.startswith("Bearer ") else ""
        if self.revoke_next:
            self.revoke_next = False
            self.tokens.discard(tok)
        if tok not in self.tokens:
            return httpx.Response(401, json={"error": "no autorizado"})
        if path == "/api/control/take":
            if self.controller not in (None, tok):
                return httpx.Response(409, json={"error": "control_held"})
            self.controller = tok
            return httpx.Response(200, json={"ok": True})
        if path == "/api/status":
            return httpx.Response(200, json={"mode": "auto", "xfader": 0.0, "state": 1, "transition": 8.0, "mixmode": 0,
                                             "controller": "dj-agent", "youAreController": True, "pendingRequest": "",
                                             "decks": [{"title": "Tema A", "loaded": 1, "playing": 1, "pos": 12.5,
                                                        "dur": 200.0, "bpm": 124.0, "key": 7},
                                                       {"title": "", "loaded": 0, "playing": 0, "pos": 0, "dur": 0,
                                                        "bpm": 0, "key": -1}]})
        if path == "/api/tracks":
            return httpx.Response(200, json={"tracks": [{"i": 0, "title": "Tema A"}, {"i": 1, "title": "Tema B"}]})
        if path == "/api/command":
            if self.controller not in (None, tok):
                return httpx.Response(409, json={"error": "control_held", "controller": "otro"})
            if req.url.params.get("action") == "inventada":
                return httpx.Response(400, json={"error": "acción desconocida"})
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)


@pytest.fixture
def cpp():
    return FakeCpp()


@pytest.fixture
def adapter(cpp):
    return ControlApiAdapter("http://engine:8787", "agente", "clave", transport=httpx.MockTransport(cpp))


def test_login_por_cuerpo_y_credenciales_nunca_en_la_url(adapter, cpp):
    adapter.status()
    login = cpp.requests[0]
    assert login.method == "POST" and login.url.path == "/api/login"
    assert "clave" not in str(login.url) and "pass=clave" in login.content.decode()
    assert cpp.requests[1].headers["Authorization"] == "Bearer t1"


def test_status_y_tracks_se_traducen(adapter):
    snap = adapter.status()
    assert snap.reachable and snap.engine_mode == "auto" and snap.decks[0].playing and snap.decks[0].bpm == 124.0
    tracks = adapter.tracks()
    assert [t.title for t in tracks] == ["Tema A", "Tema B"] and not tracks[0].has_metadata  # brecha B1


def test_comando_con_parametros_en_query_y_sin_campos_ajenos(adapter, cpp):
    adapter.execute("eq", {"deck": 1, "low": -12.0, "mid": 0.0, "high": 0.0})
    adapter.execute("deck_load", {"deck": 0, "track": 1, "confirm": True})
    eq, load = cpp.requests[-2], cpp.requests[-1]
    assert eq.url.params["action"] == "eq" and eq.url.params["deck"] == "1" and eq.url.params["low"] == "-12.0"
    assert "confirm" not in load.url.params and load.url.params["track"] == "1"


def test_cambio_de_modo_usa_set_mode_dj(adapter, cpp):
    adapter.set_engine_mode("manual")
    assert cpp.requests[-1].url.params["action"] == "set_mode_dj" and cpp.requests[-1].url.params["value"] == "manual"


def test_token_revocado_relogin_una_sola_vez(adapter, cpp):
    adapter.status()
    cpp.revoke_next = True
    adapter.status()
    assert sum(1 for r in cpp.requests if r.url.path == "/api/login") == 2


def test_control_ocupado_no_se_arrebata(adapter, cpp):
    cpp.controller = "otro-dispositivo"
    with pytest.raises(EngineError) as exc:
        adapter.execute("skip", {})
    assert exc.value.code == "control_held"
    with pytest.raises(EngineError):
        adapter.take_control()


def test_errores_mapeados(cpp):
    bad = ControlApiAdapter("http://engine:8787", "agente", "mala", transport=httpx.MockTransport(cpp))
    with pytest.raises(EngineError) as exc:
        bad.status()
    assert exc.value.code == "engine_auth_failed"

    def down(req):
        raise httpx.ConnectError("sin red")

    off = ControlApiAdapter("http://engine:8787", "agente", "clave", transport=httpx.MockTransport(down))
    with pytest.raises(EngineError) as exc:
        off.status()
    assert exc.value.code == "engine_unreachable"


def test_accion_rechazada_y_cola_no_disponible(adapter):
    with pytest.raises(EngineError) as exc:
        adapter.execute("inventada", {})
    assert exc.value.code == "engine_rejected"
    with pytest.raises(EngineCapabilityError):
        adapter.execute("queue_set", {"track_ids": [1]})
    assert "queue" not in adapter.capabilities()
