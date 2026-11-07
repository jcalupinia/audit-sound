"""Integración contra el BINARIO REAL del motor (build/audit_sound_server). Fase 2.

Se ejecuta solo si DJ_AGENT_REAL_ENGINE_BIN apunta al binario compilado; si no, se omite.
Genera pistas sintéticas con pulso rítmico (sin datos de clientes) y arranca el motor en un
puerto local con salida MP3 a disco (sin Icecast ni producción).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters.engine_control_api import ControlApiAdapter
from app.core.settings import Settings
from app.main import create_app
from tests.conftest import TOKENS, H

BIN = os.getenv("DJ_AGENT_REAL_ENGINE_BIN", "")
pytestmark = pytest.mark.skipif(not (BIN and Path(BIN).exists() and shutil.which("ffmpeg")),
                                reason="DJ_AGENT_REAL_ENGINE_BIN no definido o sin ffmpeg")
PORT = 18890
USER, PASS = "agente", "clave-de-prueba"
BPMS = [124, 124, 126, 128, 122, 120, 130, 126]
TRACK_SECONDS = 40
BASE = "/api/v1/dj-agent"


def _make_music(d: Path) -> None:
    d.mkdir(parents=True, exist_ok=True)
    for i, bpm in enumerate(BPMS):
        hz = 110 * (i + 1)
        expr = f"0.7*sin(2*PI*55*t)*exp(-25*mod(t\\,60/{bpm}))+0.15*sin(2*PI*{hz}*t)"
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                        f"aevalsrc='{expr}':s=44100:d={TRACK_SECONDS}", "-ac", "2",
                        str(d / f"pista_{i:02d}_{bpm}bpm.wav"), "-y"], check=True)


@pytest.fixture(scope="module")
def engine_proc(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("motor")
    _make_music(tmp / "music")
    mp3 = tmp / "salida.mp3"
    env = {**os.environ, "AUDIT_SOUND_MUSIC_DIR": str(tmp / "music"), "AUDIT_SOUND_TRANSITION": "4",
           "AUDIT_SOUND_MP3_OUT": str(mp3), "AUDIT_SOUND_API_USER": USER, "AUDIT_SOUND_API_PASS": PASS,
           "AUDIT_SOUND_API_PORT": str(PORT)}
    log = open(tmp / "server.log", "w")  # noqa: SIM115
    proc = subprocess.Popen([BIN], env=env, stdout=log, stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{PORT}"
    for _ in range(120):  # /api/status sin token → 401 cuando la API ya escucha (no consume el límite de login)
        try:
            if httpx.get(f"{base}/api/status", timeout=1).status_code == 401:
                break
        except httpx.HTTPError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("el motor real no arrancó")
    yield {"proc": proc, "base": base, "mp3": mp3, "log": tmp / "server.log"}
    proc.terminate()
    proc.wait(timeout=10)
    log.close()


@pytest.fixture(scope="module")
def probe(engine_proc, ad):
    """Observador de solo lectura con UN login (el motor limita a 8 logins por IP cada 5 min).
    Entra después del agente para no quedarse con el control (el motor se lo da al primero)."""
    ad.status()
    tok = httpx.post(f"{engine_proc['base']}/api/login", data={"user": USER, "pass": PASS, "name": "sonda"}).json()["token"]
    get = lambda: httpx.get(f"{engine_proc['base']}/api/status", headers={"Authorization": f"Bearer {tok}"}).json()  # noqa: E731
    yield get
    httpx.post(f"{engine_proc['base']}/api/logout", headers={"Authorization": f"Bearer {tok}"})


def _adapter(base: str, store: dict | None = None) -> ControlApiAdapter:
    ts = (lambda: store.get("t"), lambda v: store.__setitem__("t", v)) if store is not None else None
    return ControlApiAdapter(base, USER, PASS, device_name="dj-agent", token_store=ts)


@pytest.fixture(scope="module")
def ad(engine_proc):
    a = _adapter(engine_proc["base"], {})
    yield a
    a.close()


def _wait(pred, timeout: float, step: float = 0.5):
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = pred()
        if v:
            return v
        time.sleep(step)
    return None


def test_motor_real_metadatos_y_capacidades(engine_proc, ad):
    assert {"metadata", "queue"} <= ad.capabilities()
    tracks = ad.tracks()
    assert [round(t.bpm) for t in tracks] == BPMS            # el análisis real coincide con lo generado
    assert all(t.has_metadata and t.duration and abs(t.duration - TRACK_SECONDS) < 1 for t in tracks)


def test_motor_real_cola_con_prioridad_y_vuelta_al_selector(engine_proc, ad):
    titles = {t.id: t.title for t in ad.tracks()}
    on_air = lambda: next((d.title for d in ad.status().decks if d.playing and d.title), None)  # noqa: E731
    current = on_air()
    target = next(i for i, t in titles.items() if t != current)
    ad.execute("queue_set", {"track_ids": [target]})
    assert ad.status().queue == [target] and ad.status().next_source == "agent"
    # El AutoMix precarga la siguiente pista apenas empieza una: la cola entra en la siguiente
    # carga libre (como mucho, una pista después de la ya precargada). Pistas de 40 s.
    got = _wait(lambda: ad.status().queue == [] and titles[target] in [d.title for d in ad.status().decks],
                timeout=2 * TRACK_SECONDS + 15)
    assert got, "el AutoMix no tomó la pista de la cola del agente"
    assert ad.status().next_source == "selector"             # cola vacía → vuelve el Selector


def test_motor_real_treinta_cambios_de_modo_sin_reinicio(engine_proc, ad):
    proc = engine_proc["proc"]
    # Empezar justo después de una transición para no confundir un cambio del AutoMix con un corte.
    _wait(lambda: (lambda s: any(d.playing and d.pos < 6 for d in s.decks))(ad.status()), timeout=TRACK_SECONDS + 10)
    s0 = ad.status()
    deck0 = next(d for d in s0.decks if d.playing)
    size0 = engine_proc["mp3"].stat().st_size
    prev_pos = deck0.pos
    for i in range(30):
        ad.set_engine_mode("manual" if i % 2 == 0 else "auto")
        d = next(x for x in ad.status().decks if x.deck == deck0.deck)
        assert d.playing and d.title == deck0.title, f"cambio {i}: el plato al aire se cortó o recargó"
        assert d.pos >= prev_pos
        prev_pos = d.pos
    ad.set_engine_mode("auto")
    assert proc.poll() is None                                # el proceso nunca se reinició
    time.sleep(2)
    assert engine_proc["mp3"].stat().st_size > size0          # el audio siguió saliendo


def test_agente_completo_con_motor_real_y_agente_caido(engine_proc, ad, probe, tmp_path):
    base = engine_proc["base"]
    settings = Settings(db_path=str(tmp_path / "a.db"), dev_tokens=";".join(TOKENS.values()), scheduler_enabled=False,
                        engine_kind="control_api", engine_url=base, engine_user=USER, engine_pass=PASS)
    app = create_app(settings, engine=ad)   # al apagarse, el agente libera el control (close)
    with TestClient(app) as c:
        s = c.post(f"{BASE}/sessions", json={"name": "Real", "mode": "AUTOMATICO"}, headers=H("op1")).json()
        assert s["state"] == "PLAYING" and s["engine"]["reachable"]
        r = c.post(f"{BASE}/sessions/{s['id']}/intent", json={"text": "sube la energía"}, headers=H("op1")).json()
        assert r["outcome"] == "executed", r
        assert r["commands"][0]["status"] == "ACKNOWLEDGED"
        ack = [e for e in c.get(f"{BASE}/sessions/{s['id']}/events?limit=500", headers=H("op1")).json()
               if e["type"] == "agent.command.ack"][-1]
        assert ack["payload"]["ack_level"] in ("state_verified", "engine_ok")
        planned = [i["title"] for i in r["plan"]["items"]]
        assert planned and not any("metadatos_no_disponibles" in w for w in r["plan"]["warnings"])  # con metadatos reales
        cat = c.get(f"{BASE}/catalog/tracks", headers=H("op1")).json()
        assert cat["metadata_available"] is True and "queue" in cat["capabilities"]
        cid = c.post(f"{BASE}/sessions/{s['id']}/commands", json={"action": "set_transition", "params": {"value": 4}},
                     headers=H("op1", str(uuid.uuid4()))).json()
        assert cid["status"] == "ACKNOWLEDGED"
    # El agente se detuvo: el motor real sigue sonando y mezclando por su cuenta.
    size0 = engine_proc["mp3"].stat().st_size
    first = probe()["decks"]
    changed = _wait(lambda: [d["title"] for d in probe()["decks"] if d["playing"]] !=
                    [d["title"] for d in first if d["playing"]], timeout=TRACK_SECONDS + 15, step=1)
    assert changed, "sin el agente, el AutoMix no siguió mezclando"
    assert engine_proc["mp3"].stat().st_size > size0 and engine_proc["proc"].poll() is None


def test_reinicio_y_caida_del_agente_recupera_el_control(engine_proc):
    """Va al final: el agente anterior ya liberó el control al apagarse (close)."""
    base, store = engine_proc["base"], {}
    a = _adapter(base, store)
    assert a.execute("set_transition", {"value": 5})["ok"]                 # el agente toma el control
    # CAÍDA (sin close): un proceso nuevo del agente reutiliza el token persistido y sigue mandando
    b = _adapter(base, store)
    assert b.execute("set_transition", {"value": 6})["ok"]
    # Un tercero sin token persistido NO puede arrebatar el control mientras la sesión vive
    c = _adapter(base, {})
    with pytest.raises(Exception) as exc:
        c.execute("set_transition", {"value": 7})
    assert getattr(exc.value, "code", "") == "control_held"
    b.close()                                                                # apagado ordenado: libera
    assert c.execute("set_transition", {"value": 8})["ok"]                   # ahora sí lo toma (estaba libre)
    c.close()
