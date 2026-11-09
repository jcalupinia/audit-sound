"""Micrófonos del DJ al stream: WebSocket de voz del agente → motor (/api/voice) y talkover."""

from __future__ import annotations

import math
import struct

import pytest
from starlette.websockets import WebSocketDisconnect

from tests.conftest import BASE, H, new_session

URL = "/api/v1/dj-agent/sessions/{}/voice"


def _pcm(ms: int, sr: int = 48000) -> bytes:
    n = sr * ms // 1000
    return struct.pack(f"<{n}h", *(int(8000 * math.sin(2 * math.pi * 440 * i / sr)) for i in range(n)))


def test_la_voz_llega_al_motor_en_orden_y_con_su_frecuencia(client, engine):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1", "sample_rate": 48000})
        assert ws.receive_json() == {"type": "voice.ready", "sample_rate": 48000}
        for _ in range(12):
            ws.send_bytes(_pcm(100))
        ws.send_json({"type": "talkover", "mode": 1, "gain": 1.3, "duck": -18})
        msg = ws.receive_json()
        while msg["type"] != "talkover.ok":
            msg = ws.receive_json()
        ws.send_json({"type": "ping"})
        while ws.receive_json()["type"] != "pong":
            pass
    # 12 bloques de 100 ms = 1,2 s de voz (pueden llegar agrupados, nunca perdidos sin retraso)
    assert engine.voice_bytes == 12 * 9600 and engine.voice_rates == {48000}
    assert engine.talkover_mode == 1
    assert ("talkover", {"value": 1, "gain": 1.3, "duck": -18.0}) in engine.calls
    evs = client.get(f"{BASE}/sessions/{sid}/events?limit=500", headers=H("op1")).json()
    tipos = [e["type"] for e in (evs["events"] if isinstance(evs, dict) else evs)]
    assert "voice.started" in tipos and "voice.stopped" in tipos


@pytest.mark.parametrize("token,code", [("tk-lis", 4403), ("tk-sup", 4403), ("tk-otro-inventado", 4401),
                                        ("tk-other", 4404)])
def test_solo_operadores_de_la_organizacion_pueden_hablar(client, token, code):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": token})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
    assert e.value.code == code


def test_sin_autenticar_y_frecuencia_invalida(client):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "hola"})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
    assert e.value.code == 4401
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1", "sample_rate": 500})
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_json()
    assert e.value.code == 4400


def test_bloques_invalidos_se_rechazan_sin_cortar(client, engine):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1", "sample_rate": 16000})
        ws.receive_json()
        ws.send_bytes(b"\x01\x02\x03")             # impar: no es PCM 16 bits
        assert ws.receive_json() == {"type": "voice.error", "code": "bad_frame"}
        ws.send_bytes(b"\x00" * (70 * 1024))       # más de 64 KB
        assert ws.receive_json() == {"type": "voice.error", "code": "bad_frame"}
        ws.send_bytes(_pcm(100, 16000))
        ws.send_json({"type": "ping"})
        while ws.receive_json()["type"] != "pong":
            pass
    assert engine.voice_bytes == 3200 and engine.voice_rates == {16000}


def test_motor_caido_avisa_y_la_musica_no_depende_de_la_voz(client, engine):
    sid = new_session(client)["id"]
    with client.websocket_connect(URL.format(sid)) as ws:
        ws.send_json({"type": "auth", "token": "tk-op1"})
        ws.receive_json()
        engine.set_reachable(False)
        ws.send_bytes(_pcm(100))
        ws.send_json({"type": "talkover", "mode": 2})
        msg = ws.receive_json()
        while msg["type"] != "voice.error":
            msg = ws.receive_json()
        assert msg["code"] == "engine_unreachable"
        engine.set_reachable(True)
