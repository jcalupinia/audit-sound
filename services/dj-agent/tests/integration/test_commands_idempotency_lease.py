"""Comandos con ACK real del motor, idempotencia (incluida concurrencia) y lease de control."""

from __future__ import annotations

import threading

from app.adapters.engine_fake import FakeEngine
from app.core.errors import AppError
from app.domain.models import CommandIn
from tests.conftest import BASE, TOKENS, H, K, command, new_session


# ---------------------------------------------------------------- ACK real
def test_ack_solo_tras_confirmar_en_el_estado_del_motor(client, engine):
    sid = new_session(client)["id"]
    r = command(client, sid, "xfader", {"value": 0.25}).json()
    assert r["status"] == "ACKNOWLEDGED" and engine.xfader == 0.25
    cmds = client.get(f"{BASE}/sessions/{sid}/commands", headers=H("op1")).json()
    assert cmds[0]["status"] == "ACKNOWLEDGED"
    evs = client.get(f"{BASE}/sessions/{sid}/events", headers=H("op1")).json()
    ack = next(e for e in evs if e["type"] == "agent.command.ack")
    assert ack["payload"]["ack_level"] == "state_verified" and ack["correlation_id"]
    eq = command(client, sid, "eq", {"deck": 0, "low": -12}).json()
    assert eq["status"] == "ACKNOWLEDGED"   # efecto no observable en /status → ack_level engine_ok


def test_rechazo_del_motor_se_reporta_como_fallo(client, engine):
    sid = new_session(client)["id"]
    engine.fail_next("eq", "engine_rejected")
    r = command(client, sid, "eq", {"deck": 0, "low": -3}).json()
    assert r["status"] == "FAILED" and r["error_code"] == "engine_rejected"


class LyingEngine(FakeEngine):
    """Responde OK al crossfader pero no lo aplica."""

    def execute(self, engine_action, params):
        if engine_action == "xfader":
            with self._lock:
                self.calls.append((engine_action, dict(params)))
            return {"ok": True}
        return super().execute(engine_action, params)


def test_ok_del_motor_sin_efecto_observable_no_es_exito(settings, clock):
    from fastapi.testclient import TestClient

    from app.main import create_app
    with TestClient(create_app(settings, engine=LyingEngine(), clock=clock)) as c:
        sid = new_session(c)["id"]
        r = command(c, sid, "xfader", {"value": 0.7}).json()
        assert r["status"] == "FAILED" and r["error_code"] == "effect_not_observed"


def test_motor_inalcanzable_sesion_en_recuperacion_y_vuelta(client, engine):
    sid = new_session(client)["id"]
    engine.set_reachable(False)
    r = command(client, sid, "skip").json()
    assert r["status"] == "FAILED" and r["error_code"] == "engine_unreachable"
    s = client.get(f"{BASE}/sessions/{sid}", headers=H("op1")).json()
    assert s["state"] == "RECOVERING" and s["agent_state"] == "AVAILABLE" and not s["engine"]["reachable"]
    engine.set_reachable(True)
    assert client.get(f"{BASE}/sessions/{sid}", headers=H("op1")).json()["state"] == "PLAYING"


def test_no_se_carga_encima_del_plato_al_aire_sin_confirmar(client, engine):
    sid = new_session(client)["id"]
    r = command(client, sid, "deck_load", {"deck": 0, "track": 5})
    assert r.status_code == 409 and r.json()["error"]["code"] == "on_air_deck"
    assert command(client, sid, "deck_load", {"deck": 1, "track": 5}).json()["status"] == "ACKNOWLEDGED"
    assert command(client, sid, "deck_load", {"deck": 0, "track": 6, "confirm": True}).json()["status"] == "ACKNOWLEDGED"


def test_validacion_de_entrada(client):
    sid = new_session(client)["id"]
    assert command(client, sid, "xfader", {"value": 9}).json()["error"]["code"] == "invalid_params"
    assert command(client, sid, "borrar_todo").json()["error"]["code"] == "unknown_action"
    r = client.post(f"{BASE}/sessions/{sid}/commands", json={"action": "skip", "intruso": 1}, headers=H("op1", K()))
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_capacidad_inexistente_en_el_motor_actual(settings, clock):
    from fastapi.testclient import TestClient

    from app.main import create_app
    with TestClient(create_app(settings, engine=FakeEngine(emulate_current_engine=True), clock=clock)) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        r = command(c, sid, "queue_set", {"track_ids": [1, 2]})
        assert r.status_code == 409 and r.json()["error"]["details"]["capability"] == "queue"
        out = c.post(f"{BASE}/sessions/{sid}/intent", json={"text": "pon salsa"}, headers=H("op1")).json()
        assert out["outcome"] == "informational" and "Fase 2" in out["message"]
        assert any("metadatos_no_disponibles_B1" in w for w in out["plan"]["warnings"])
        cat = c.get(f"{BASE}/catalog/tracks", headers=H("op1")).json()
        assert cat["metadata_available"] is False and "queue" not in cat["capabilities"]


# ---------------------------------------------------------------- idempotencia
def test_idempotencia_obligatoria_replay_y_conflicto(client, engine):
    sid = new_session(client)["id"]
    r = client.post(f"{BASE}/sessions/{sid}/commands", json={"action": "skip"}, headers=H("op1"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "idempotency_key_required"
    key = K()
    first = command(client, sid, "xfader", {"value": 0.3}, key=key).json()
    second = command(client, sid, "xfader", {"value": 0.3}, key=key).json()
    assert second["idempotent_replay"] is True and second["id"] == first["id"]
    assert engine.count_calls("xfader") == 1            # doble clic: una sola ejecución
    clash = command(client, sid, "xfader", {"value": 0.9}, key=key)
    assert clash.status_code == 409 and clash.json()["error"]["code"] == "idempotency_conflict"


def test_reintento_de_un_comando_fallido_no_lo_reenvia(client, engine):
    sid = new_session(client)["id"]
    engine.fail_next("skip")
    key = K()
    assert command(client, sid, "skip", key=key).json()["status"] == "FAILED"
    assert command(client, sid, "skip", key=key).json()["status"] == "FAILED"
    assert engine.count_calls("skip") == 1


def test_error_de_validacion_libera_la_clave(client, engine):
    sid = new_session(client)["id"]
    key = K()
    assert command(client, sid, "xfader", {"value": 7}, key=key).status_code == 422
    assert command(client, sid, "xfader", {"value": 0.6}, key=key).json()["status"] == "ACKNOWLEDGED"


def test_concurrencia_misma_clave_una_sola_ejecucion(client, engine):
    sid = new_session(client)["id"]
    m = client.app.state.manager
    principal = client.app.state.auth.authenticate("tk-op1")
    key, results, errors = K(), [], []

    def worker():
        try:
            results.append(m.submit_command(sid, principal, CommandIn(action="skip"), key, "corr"))
        except AppError as exc:
            errors.append(exc.code)

    threads = [threading.Thread(target=worker) for _ in range(12)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert engine.count_calls("skip") == 1
    assert len(results) + len(errors) == 12 and set(errors) <= {"request_in_progress"}
    assert len({r["id"] for r in results}) == 1


# ---------------------------------------------------------------- varios operadores
def test_lease_de_control_entre_operadores(client, clock):
    sid = new_session(client)["id"]                               # ana (op1) toma el control al crear
    r = command(client, sid, "skip", who="op2")
    assert r.status_code == 409 and r.json()["error"]["code"] == "control_held"
    ctl = lambda who, action: client.post(f"{BASE}/sessions/{sid}/control", json={"action": action},  # noqa: E731
                                          headers=H(who))
    assert ctl("op2", "take").status_code == 409
    assert ctl("op2", "request").json()["pending_control_request"] == "beto"
    assert ctl("op2", "approve").status_code == 409                # solo el que controla aprueba
    assert ctl("op1", "approve").json()["controller_id"] == "beto"
    assert command(client, sid, "skip", who="op1").status_code == 409
    assert command(client, sid, "skip", who="op2").json()["status"] == "ACKNOWLEDGED"
    clock.advance(client.app.state.settings.lease_seconds + 1)     # beto deja de enviar latidos
    assert command(client, sid, "skip", who="op1").json()["status"] == "ACKNOWLEDGED"
    assert ctl("op1", "force").status_code == 403                  # forzar es solo de administrador
    assert ctl("admin", "force").json()["controller_id"] == "root"
    evs = client.get(f"{BASE}/sessions/{sid}/events?limit=500", headers=H("admin")).json()
    assert {"control.requested", "control.transferred", "control.forced"} <= {e["type"] for e in evs}


def test_tokens_conocidos():
    assert all(t.startswith("tk-") for t in TOKENS.values())
