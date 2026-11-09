"""Los tres modos con estados verificables y cambio de modo sin reiniciar el motor."""

from __future__ import annotations

from tests.conftest import BASE, H, K, command, intent, new_session, prefs, set_mode

CYCLE = ["MANUAL", "HIBRIDO", "AUTOMATICO", "HIBRIDO", "MANUAL", "AUTOMATICO"]


def test_treinta_cambios_de_modo_sin_reinicio_ni_corte(client, engine):
    sid = new_session(client)["id"]
    track0, pos0 = engine.decks[0].track_id, engine.decks[0].pos
    engine_calls0 = engine.count_calls("set_mode_dj")
    prev_pos, prev_mode = pos0, "HIBRIDO"
    expected_engine_calls = 0
    for i in range(30):
        target = CYCLE[i % len(CYCLE)]
        if target == prev_mode:
            target = "AUTOMATICO" if prev_mode != "AUTOMATICO" else "HIBRIDO"
        if (target == "MANUAL") != (prev_mode == "MANUAL"):
            expected_engine_calls += 1     # HIBRIDO↔AUTOMATICO no toca el motor
        engine.advance(1.0)
        r = set_mode(client, sid, target)
        assert r.status_code == 200, r.text
        assert r.json()["mode"] == target
        d0 = engine.decks[0]
        assert d0.playing and d0.track_id == track0 and d0.pos > prev_pos   # mismo tema, sin saltos atrás
        prev_pos, prev_mode = d0.pos, target
    assert engine.restart_count == 0 and engine.stream_epoch == 1 and engine.silence_seconds == 0.0
    assert engine.count_calls("set_mode_dj") - engine_calls0 == expected_engine_calls
    assert engine.count_calls("deck_load") == 0           # nunca se recargó el plato al aire
    evs = client.get(f"{BASE}/sessions/{sid}/events?limit=500", headers=H("op1")).json()
    assert sum(1 for e in evs if e["type"] == "mode.changed") == 30


def test_manual_el_agente_solo_observa(client, engine):
    sid = new_session(client, mode="MANUAL")["id"]
    r = intent(client, sid, "salta la canción").json()
    assert r["outcome"] == "informational" and engine.count_calls("skip") == 0
    r = intent(client, sid, "pon salsa").json()
    assert r["outcome"] == "informational" and r["plan"]["items"] and engine.count_calls("queue_set") == 0
    assert command(client, sid, "xfader", {"value": 0.4}).json()["status"] == "ACKNOWLEDGED"  # el humano sí


def test_hibrido_propuesta_y_aprobacion(client, engine):
    sid = new_session(client)["id"]
    r = intent(client, sid, "salta la canción").json()
    assert r["outcome"] == "proposal" and engine.count_calls("skip") == 0
    pid = r["proposal"]["id"]
    pending = client.get(f"{BASE}/sessions/{sid}/proposals?status=PENDING", headers=H("op1")).json()
    assert [p["id"] for p in pending] == [pid]
    d = client.post(f"{BASE}/sessions/{sid}/proposals/{pid}/decision", json={"decision": "approve"},
                    headers=H("sup", K())).json()
    assert d["proposal"]["status"] == "EXECUTED" and d["proposal"]["decided_by"] == "sofia"
    assert d["commands"][0]["status"] == "ACKNOWLEDGED" and d["commands"][0]["origin"] == "agent"
    assert engine.count_calls("skip") == 1
    again = client.post(f"{BASE}/sessions/{sid}/proposals/{pid}/decision", json={"decision": "approve"},
                        headers=H("sup", K()))
    assert again.status_code == 409 and again.json()["error"]["code"] == "proposal_not_pending"


def test_hibrido_rechazo_no_ejecuta(client, engine):
    sid = new_session(client)["id"]
    pid = intent(client, sid, "transiciones de 15 segundos").json()["proposal"]["id"]
    d = client.post(f"{BASE}/sessions/{sid}/proposals/{pid}/decision", json={"decision": "reject"},
                    headers=H("op1", K())).json()
    assert d["proposal"]["status"] == "REJECTED" and engine.count_calls("set_transition") == 0


def test_hibrido_autoejecuta_lo_autorizado_por_politica(client, engine):
    sid = new_session(client)["id"]
    assert prefs(client, sid, {"approval_required": False, "hybrid_auto_actions": ["skip"]}).status_code == 200
    r = intent(client, sid, "siguiente").json()
    assert r["outcome"] == "executed" and r["commands"][0]["status"] == "ACKNOWLEDGED"
    bad = prefs(client, sid, {"hybrid_auto_actions": ["deck_pause"]})   # peligrosa: nunca automática
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_actions"


def test_automatico_ejecuta_dentro_de_limites(client, engine):
    sid = new_session(client, mode="AUTOMATICO")["id"]
    r = intent(client, sid, "salta la canción").json()
    assert r["outcome"] == "executed" and engine.count_calls("skip") == 1
    r = intent(client, sid, "pausa la música").json()                # peligrosa → aprobación humana
    assert r["outcome"] == "proposal" and engine.count_calls("deck_pause") == 0
    prefs(client, sid, {"autonomy": 10})
    r = intent(client, sid, "siguiente").json()                        # fuera del nivel de autonomía
    assert r["outcome"] == "proposal" and engine.count_calls("skip") == 1


def test_limite_de_saltos_por_hora(client, engine):
    sid = new_session(client, mode="AUTOMATICO")["id"]
    client.app.state.manager.store.update_session(sid, policy_json={**client.app.state.manager._policy(
        client.app.state.manager.store.get_session(sid)).to_dict(), "max_skips_per_hour": 2})
    outs = [intent(client, sid, "siguiente").json()["outcome"] for _ in range(3)]
    assert outs == ["executed", "executed", "proposal"] and engine.count_calls("skip") == 2


def test_pasar_a_manual_caduca_propuestas_pendientes(client):
    sid = new_session(client)["id"]
    pid = intent(client, sid, "siguiente").json()["proposal"]["id"]
    set_mode(client, sid, "MANUAL")
    props = client.get(f"{BASE}/sessions/{sid}/proposals", headers=H("op1")).json()
    assert next(p for p in props if p["id"] == pid)["status"] == "EXPIRED"


def test_cambio_de_modo_por_instruccion_y_version_optimista(client):
    s = new_session(client)
    r = intent(client, s["id"], "modo automático").json()
    assert r["outcome"] == "executed" and r["mode"] == "AUTOMATICO"
    stale = client.post(f"{BASE}/sessions/{s['id']}/mode", json={"mode": "MANUAL", "expected_version": s["version"]},
                        headers=H("op1", K()))
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"


def test_motor_caido_no_cambia_el_modo(client, engine):
    sid = new_session(client)["id"]
    engine.set_reachable(False)
    r = set_mode(client, sid, "MANUAL")
    assert r.status_code == 503 and r.json()["error"]["code"] == "engine_unreachable"
    engine.set_reachable(True)
    assert client.get(f"{BASE}/sessions/{sid}", headers=H("op1")).json()["mode"] == "HIBRIDO"


def test_automatico_replanifica_aunque_el_motor_no_informe_ids(settings, clock):
    """Motor real: los platos traen título pero no índice. El agente debe ver avanzar su plan."""
    from fastapi.testclient import TestClient

    from app.adapters.engine_fake import FakeEngine
    from app.main import create_app

    class TitleOnly(FakeEngine):
        def status(self):
            snap = super().status()
            for d in snap.decks:
                d.track_id = None
            return snap

    eng = TitleOnly()
    with TestClient(create_app(settings, engine=eng, clock=clock)) as c:
        sid = new_session(c, mode="AUTOMATICO")["id"]
        m = c.app.state.manager
        clock.advance(60)
        m.tick(sid)
        first = c.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()
        for _ in range(6):                      # consumir el plan (6 pistas de 180 s)
            eng.advance(180)
            clock.advance(40)
            m.tick(sid)
        second = c.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()
        assert second["id"] != first["id"] and second["status"] == "ACTIVE"   # replanificó solo


def test_orden_por_voz_queda_registrada_con_su_canal(client):
    """Fase 6: el dictado se audita como canal «voice»; los permisos y la política no cambian."""
    sid = new_session(client)["id"]
    r = client.post(f"{BASE}/sessions/{sid}/intent", json={"text": "salta la canción", "channel": "voice"},
                    headers=H("op1"))
    assert r.status_code == 200 and r.json()["intent"] == "SKIP_TRACK"
    evs = client.get(f"{BASE}/sessions/{sid}/events", headers=H("op1")).json()
    parsed = [e for e in evs if e["type"] == "agent.intent.parsed"]
    assert parsed[-1]["payload"]["channel"] == "voice"
    assert client.post(f"{BASE}/sessions/{sid}/intent", json={"text": "x", "channel": "telepatia"},
                       headers=H("op1")).status_code == 422
    texto = client.post(f"{BASE}/sessions/{sid}/intent", json={"text": "salta la canción"}, headers=H("op1"))
    assert texto.status_code == 200


def test_el_plan_no_repite_la_pista_que_el_motor_ya_preparo(settings, clock, tmp_path):
    """Producción 2026-11-08: la pista cargada en el otro deck sonaba y luego el plan la repetía."""
    import dataclasses

    from fastapi.testclient import TestClient

    from app.adapters.engine_fake import FakeEngine
    from app.main import create_app

    def primer_plan(cued_title: str | None):
        cfg = dataclasses.replace(settings, db_path=str(tmp_path / f"cued_{bool(cued_title)}.db"))
        class ConCued(FakeEngine):
            def status(self):
                snap = super().status()
                if cued_title:
                    on = next(d for d in snap.decks if d.playing)
                    other = next(d for d in snap.decks if d.deck != on.deck)
                    other.loaded, other.playing, other.title, other.track_id = True, False, cued_title, None
                return snap

        with TestClient(create_app(cfg, engine=ConCued(), clock=clock)) as c:
            sid = new_session(c, mode="AUTOMATICO")["id"]
            clock.advance(60)
            c.app.state.manager.tick(sid)
            return c.get(f"{BASE}/sessions/{sid}/plans/current", headers=H("op1")).json()

    sin = primer_plan(None)
    elegida = sin["items"][0]["title"]
    con = primer_plan(elegida)
    assert elegida not in [i["title"] for i in con["items"]]
