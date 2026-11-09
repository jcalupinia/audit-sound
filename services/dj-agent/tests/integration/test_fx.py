"""Efectos de audio: comando «fx» del agente → motor (lista blanca, validación y capacidad)."""

from __future__ import annotations

import httpx
import pytest

from app.adapters.engine_control_api import ControlApiAdapter
from tests.conftest import command, new_session


def test_fx_llega_al_motor_y_se_confirma(client, engine):
    sid = new_session(client)["id"]
    r = command(client, sid, "fx", {"bank": 1, "type": "echo", "target": "A", "on": True, "wet": 0.5, "param": 0.3,
                                    "sync": True})
    assert r.status_code == 200 and r.json()["status"] == "ACKNOWLEDGED", r.text
    assert engine.fx[0] == {"bank": 1, "type": "echo", "target": "A", "on": True, "wet": 0.5, "param": 0.3, "sync": True}
    r = command(client, sid, "fx", {"bank": 1, "on": False})   # solo apagar: conserva lo demás
    assert r.status_code == 200 and engine.fx[0]["type"] == "echo" and engine.fx[0]["on"] is False


@pytest.mark.parametrize("params", [{"bank": 3}, {"bank": 1, "type": "distorsion"}, {"bank": 1, "target": "C"},
                                    {"bank": 1, "wet": 1.5}, {"bank": 1, "param": -0.1}, {"bank": 1, "otro": 1}, {}])
def test_fx_parametros_invalidos_se_rechazan(client, engine, params):
    sid = new_session(client)["id"]
    r = command(client, sid, "fx", params)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_params"
    assert engine.count_calls("fx") == 0


def test_fx_solo_para_operadores(client):
    sid = new_session(client)["id"]
    r = command(client, sid, "fx", {"bank": 1, "on": True}, who="lis")
    assert r.status_code == 403


def test_motor_sin_efectos(settings, clock):
    from fastapi.testclient import TestClient

    from app.adapters.engine_fake import FakeEngine
    from app.main import create_app

    with TestClient(create_app(settings, engine=FakeEngine(emulate_current_engine=True), clock=clock)) as c:
        sid = new_session(c)["id"]
        r = command(c, sid, "fx", {"bank": 1, "on": True})
        assert r.status_code == 409 and r.json()["error"]["code"] == "capability_unavailable"


def test_adaptador_envia_fx_como_comando_con_booleanos_0_1():
    vistos: list[httpx.Request] = []

    def motor(req: httpx.Request) -> httpx.Response:
        vistos.append(req)
        if req.url.path == "/api/login":
            return httpx.Response(200, json={"token": "t", "youAreController": True})
        if req.url.path == "/api/status":
            return httpx.Response(200, json={"mode": "auto", "decks": [], "queue": [], "fx": []})
        if req.url.path == "/api/tracks":
            return httpx.Response(200, json={"metadata": True, "tracks": []})
        return httpx.Response(200, json={"ok": True})

    a = ControlApiAdapter("http://engine:8787", "agente", "clave", transport=httpx.MockTransport(motor))
    a.execute("fx", {"bank": 2, "type": "reverb", "target": "master", "on": True, "wet": 0.4, "param": None,
                     "sync": False})
    cmd = [q for q in vistos if q.url.path == "/api/command"][-1]
    assert dict(cmd.url.params) == {"action": "fx", "bank": "2", "type": "reverb", "target": "master", "on": "1",
                                    "wet": "0.4", "sync": "0"}
