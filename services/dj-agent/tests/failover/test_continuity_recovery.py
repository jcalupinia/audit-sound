"""Continuidad musical con el agente caído, fallos de IA, ciclo automático y recuperación tras reinicio."""

from __future__ import annotations

import asyncio
import logging

from fastapi.testclient import TestClient

from app.adapters.engine_fake import FakeEngine
from app.adapters.llm import LLMError
from app.main import create_app
from app.orchestration.model_router import ModelRouter
from app.workers.scheduler import scheduler_loop
from tests.conftest import BASE, H, K, intent, new_session


def test_agente_caido_el_motor_sigue_sonando_y_mezclando(settings, clock):
    engine = FakeEngine()
    with TestClient(create_app(settings, engine=engine, clock=clock)) as c:
        new_session(c, mode="AUTOMATICO")
    # el servicio del agente se detuvo (TestClient cerrado): el motor no depende de él
    t0 = engine.transitions
    engine.advance(3600)
    assert engine.transitions - t0 >= 15 and engine.silence_seconds == 0.0 and engine.restart_count == 0


def test_ciclo_del_agente_que_falla_no_afecta_al_motor():
    engine = FakeEngine()
    calls = {"n": 0}

    class Boom:
        def active_session_ids(self):
            return ["s1"]

        def tick(self, sid):
            calls["n"] += 1
            raise RuntimeError("fallo interno del agente")

    async def run():
        task = asyncio.create_task(scheduler_loop(Boom(), 0.01, logging.getLogger("test")))
        await asyncio.sleep(0.15)
        task.cancel()

    before = engine.status()
    asyncio.run(run())
    engine.advance(10)
    assert calls["n"] >= 3                              # el ciclo sobrevive a sus propios errores
    assert engine.decks[0].playing and engine.decks[0].pos > before.decks[0].pos


class DownProvider:
    name, model = "qwen", "qwen-x"

    def configured(self):
        return True

    def estimate_cost(self, a, b):
        return 0.0

    def complete(self, *a, **k):
        raise LLMError("timeout", "Qwen no responde")


def test_ia_caida_respaldo_determinista_y_musica_intacta(settings, clock):
    engine = FakeEngine()
    app = create_app(settings, engine=engine, clock=clock)
    store = app.state.store
    app.state.manager.router = ModelRouter(settings, store, {"qwen": DownProvider(), "deepseek": DownProvider()})
    with TestClient(app) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        r = intent(c, sid, "hazme algo raro con la luz").json()   # nada que las reglas reconozcan
        assert r["intent"] == "UNKNOWN" and r["source"] == "rules" and r["fallback_reasons"]
        assert intent(c, sid, "salta la canción").json()["outcome"] == "executed"  # reglas siguen operando
        assert c.get(f"{BASE}/sessions/{sid}", headers=H("op1")).json()["state"] == "PLAYING"


def test_automatico_mantiene_la_cola_y_vuelve_al_selector(client, engine, clock):
    sid = new_session(client, mode="AUTOMATICO")["id"]
    m = client.app.state.manager
    clock.advance(60)
    m.tick(sid)                                                   # sin plan → crea uno y lo encola
    plan = client.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()
    assert plan["status"] == "ACTIVE" and len(plan["items"]) == 6
    planned = [i["track_id"] for i in plan["items"]]
    engine.advance(180 * 3)
    assert engine.history[1:4] == planned[:3]                    # el motor toca la cola del agente en orden
    engine.queue.clear()                                          # cola agotada/vacía
    t = engine.transitions
    engine.advance(180 * 2)
    assert engine.transitions > t and engine.silence_seconds == 0.0   # AutoMix sigue con su selector


def test_recuperacion_tras_reinicio_sin_reenviar_comandos(settings, clock):
    engine = FakeEngine()
    with TestClient(create_app(settings, engine=engine, clock=clock)) as c:
        s = new_session(c)
        sid = s["id"]
        st = c.app.state.store
        engine.execute("deck_pause", {"deck": 0})                 # el motor sí aplicó la pausa…
        base = {"session_id": sid, "origin": "human", "actor_id": "ana", "correlation_id": "c1"}
        st.insert_command({**base, "id": "cmd-pausa", "action": "deck_pause", "params": {"deck": 0}, "status": "SENT"})
        st.insert_command({**base, "id": "cmd-xf", "action": "xfader", "params": {"value": 0.9}, "status": "SENT"})
        st.insert_command({**base, "id": "cmd-nuevo", "action": "skip", "params": {}, "status": "ACCEPTED"})
    calls_before = len(engine.calls)
    # …y el agente se reinició con esos comandos en vuelo
    with TestClient(create_app(settings, engine=engine, clock=clock)) as c2:
        st2 = c2.app.state.store
        assert st2.get_command("cmd-pausa")["status"] == "ACKNOWLEDGED"
        assert st2.get_command("cmd-xf")["error_code"] == "unknown_outcome_after_restart"
        assert st2.get_command("cmd-nuevo")["status"] == "REJECTED"
        assert len(engine.calls) == calls_before                  # no se reenvió nada
        again = c2.get(f"{BASE}/sessions/{sid}", headers=H("op2")).json()   # otro dispositivo/usuario
        assert again["id"] == sid and again["mode"] == "HIBRIDO" and again["version"] == s["version"]
        r = c2.post(f"{BASE}/sessions/{sid}/mode", json={"mode": "AUTOMATICO"}, headers=H("op1", K()))
        assert r.status_code == 200


def test_tras_caida_del_agente_el_plan_desfasado_se_replanifica(settings, clock):
    """Regresión del soak de 2 h: durante la caída el motor agota la cola y el Selector toma el aire.

    Al volver, el plan viejo sigue ACTIVO pero la pista al aire no está en él: el agente debe
    replanificar enseguida, no esperar a que por azar suene una pista del plan viejo.
    """
    engine = FakeEngine()
    with TestClient(create_app(settings, engine=engine, clock=clock)) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        clock.advance(60)
        c.app.state.manager.tick(sid)
        old = c.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()
        planned = [i["track_id"] for i in old["items"]]
    # agente caído: el motor consume la cola y sigue con el Selector
    engine.advance(180 * 10)
    assert not engine.queue
    on_air = next(d.track_id for d in engine.status().decks if d.playing)
    if on_air in planned:                                   # forzar el caso del soak: al aire, pista ajena al plan
        engine.queue.clear()
        engine.advance(180)
    with TestClient(create_app(settings, engine=engine, clock=clock)) as c2:
        clock.advance(60)
        c2.app.state.manager.tick(sid)
        new = c2.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()
        assert new["id"] != old["id"] and new["status"] == "ACTIVE"
        assert engine.queue                                  # la cola del agente vuelve al motor de inmediato


class ScriptedProvider:
    """Proveedor simulado que responde un texto fijo (como lo haría Qwen)."""
    name, model = "qwen", "qwen-x"

    def __init__(self, content):
        self.content = content

    def configured(self):
        return True

    def estimate_cost(self, a, b):
        return 0.0

    def complete(self, *a, **k):
        from app.adapters.llm import LLMResult
        return LLMResult("qwen", "qwen-x", self.content, 10, 5, 20.0)


def _con_modelo(settings, clock, content):
    engine = FakeEngine()
    app = create_app(settings, engine=engine, clock=clock)
    app.state.manager.router = ModelRouter(settings, app.state.store, {"qwen": ScriptedProvider(content)})
    return app, engine


def test_salida_del_modelo_fuera_de_lo_permitido_no_se_ejecuta(settings, clock):
    hostil = '<think>el usuario pide cargar</think>{"intent":"deck_load","parameters":{"deck":0,"track_id":3},"confidence":1}'
    app, engine = _con_modelo(settings, clock, hostil)
    with TestClient(app) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        calls = len(engine.calls)
        r = intent(c, sid, "esta canción no me gusta nada").json()
        assert r["intent"] == "UNKNOWN" and r["outcome"] == "informational"
        assert "qwen:rejected_by_validation" in r["fallback_reasons"]
        assert len(engine.calls) == calls                       # nada llegó al motor


def test_salida_valida_del_modelo_pasa_por_la_politica(settings, clock):
    app, engine = _con_modelo(settings, clock, '```json\n{"intent":"SKIP_TRACK","parameters":{},"confidence":0.9}\n```')
    with TestClient(app) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        r = intent(c, sid, "esta canción no me gusta nada").json()
        assert r["intent"] == "SKIP_TRACK" and r["source"] == "qwen" and r["confidence"] == 0.85
        assert r["outcome"] == "executed"


def test_pausa_propuesta_por_el_modelo_exige_aprobacion_humana(settings, clock):
    app, engine = _con_modelo(settings, clock, '{"intent":"PAUSE","parameters":{},"confidence":0.9}')
    with TestClient(app) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        r = intent(c, sid, "para todo un momento que vamos a dar un discurso").json()
        assert r["intent"] == "PAUSE" and r["source"] == "qwen" and r["outcome"] == "proposal"
        assert engine.decks[0].playing or engine.decks[1].playing   # el audio sigue hasta que un humano apruebe
