"""Sesiones, autenticación, RBAC por operación y aislamiento entre organizaciones."""

from __future__ import annotations

from tests.conftest import BASE, H, K, command, intent, new_session


def test_crear_sesion_estado_autoritativo(client, engine):
    s = new_session(client)
    assert s["mode"] == "HIBRIDO" and s["state"] == "PLAYING" and s["agent_state"] == "AVAILABLE"
    assert s["audio_authority"] == "server" and s["controller_id"] == "ana"
    assert s["engine"]["reachable"] and s["engine"]["decks"][0]["playing"]
    got = client.get(f"{BASE}/sessions/{s['id']}", headers=H("lis")).json()  # el oyente puede leer
    assert got["id"] == s["id"]


def test_una_sola_sesion_activa_por_motor_evita_dos_fuentes(client):
    new_session(client)
    r = client.post(f"{BASE}/sessions", json={"name": "Otra"}, headers=H("op2"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "engine_busy"


def test_sin_token_o_token_invalido(client):
    assert client.get(f"{BASE}/sessions").status_code == 401
    r = client.get(f"{BASE}/sessions", headers={"Authorization": "Bearer inventado"})
    assert r.status_code == 401 and r.headers["WWW-Authenticate"] == "Bearer"
    assert r.json()["error"]["code"] == "invalid_token" and r.json()["error"]["correlation_id"]


def test_permisos_por_operacion(client):
    sid = new_session(client)["id"]
    # oyente: solo lectura
    assert command(client, sid, "skip", who="lis").status_code == 403
    assert intent(client, sid, "salta", who="lis").status_code == 403
    # supervisor: no ejecuta comandos ni cambia el modo, pero sí instruye y decide propuestas
    assert command(client, sid, "skip", who="sup").status_code == 403
    assert client.post(f"{BASE}/sessions/{sid}/mode", json={"mode": "MANUAL"}, headers=H("sup", K())).status_code == 403
    assert intent(client, sid, "salta la canción", who="sup").status_code == 200
    assert client.get(f"{BASE}/usage", headers=H("sup")).status_code == 200
    assert client.get(f"{BASE}/usage", headers=H("op1")).status_code == 403


def test_otra_organizacion_no_ve_ni_toca_la_sesion(client):
    sid = new_session(client)["id"]
    assert client.get(f"{BASE}/sessions/{sid}", headers=H("other")).status_code == 404
    assert command(client, sid, "skip", who="other").status_code == 404
    assert client.get(f"{BASE}/sessions", headers=H("other")).json() == []


def test_cerrar_sesion_no_detiene_el_motor_y_restaura_automix(client, engine):
    sid = new_session(client, mode="MANUAL")["id"]
    assert engine.engine_mode == "manual"
    r = client.post(f"{BASE}/sessions/{sid}/close", headers=H("op1", K()))
    assert r.status_code == 200 and r.json()["state"] == "STOPPED"
    assert engine.engine_mode == "auto" and engine.decks[0].playing   # sigue sonando, AutoMix de respaldo
    assert command(client, sid, "skip").json()["error"]["code"] == "session_closed"
    new_session(client, who="op2")  # el motor queda libre para una nueva sesión


def test_salud_sin_secretos(client):
    j = client.get(f"{BASE}/health").json()
    assert j["status"] == "ok" and j["readiness"]["engine"]["kind"] == "fake"
    assert "tk-" not in str(j) and "key" not in str(j["readiness"]["models"]).lower().replace("breaker", "")
