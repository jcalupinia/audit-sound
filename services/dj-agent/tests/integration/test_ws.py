"""WebSocket: autenticación por primer mensaje, snapshot, replay acotado y sin duplicados."""

from __future__ import annotations

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import command, new_session

URL = "/api/v1/dj-agent/sessions/{}/events"


def _drain(ws, n):
    return [ws.receive_json() for _ in range(n)]


def test_snapshot_y_eventos_en_vivo(client):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1"})
        snap = ws.receive_json()
        assert snap["type"] == "session.snapshot" and snap["payload"]["id"] == sid and snap["sequence"] > 0
        command(client, sid, "xfader", {"value": 0.2})
        types, seqs = [], []
        while "agent.command.ack" not in types:
            ev = ws.receive_json()
            types.append(ev["type"])
            seqs.append(ev["sequence"])
        assert types[0] == "command.accepted" and seqs == sorted(set(seqs)) and seqs[0] > snap["sequence"]
        ws.send_json({"type": "ping"})
        msg = ws.receive_json()
        while msg["type"] != "pong":
            msg = ws.receive_json()


def test_reconexion_recupera_lo_perdido_sin_duplicar(client):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1"})
        last_seen = ws.receive_json()["sequence"]
    # el móvil pierde la red: mientras tanto ocurren cosas
    command(client, sid, "xfader", {"value": 0.4})
    command(client, sid, "set_transition", {"value": 10})
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1", "after": last_seen})
        snap = ws.receive_json()
        assert snap["type"] == "session.snapshot"
        missed = _drain(ws, snap["sequence"] - last_seen)
        seqs = [e["sequence"] for e in missed]
        assert seqs == list(range(last_seen + 1, snap["sequence"] + 1))   # completo y sin huecos
        assert snap["payload"]["engine"]["transition_seconds"] == 10.0     # el snapshot ya es el estado real


@pytest.mark.parametrize("first,code", [
    ({"type": "auth", "token": "falso"}, 4401),
    ({"type": "hola"}, 4401),
    ({"type": "auth", "token": "tk-other"}, 4404),
])
def test_cierres_por_autenticacion_o_aislamiento(client, first, code):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json(first)
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == code


def test_sin_mensaje_de_auth_se_cierra(client):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401
