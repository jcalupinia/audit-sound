#!/usr/bin/env python3
"""AUDIT SOUND · Soak de la Fase 2: motor C++ REAL + Icecast + Agente DJ en AUTOMÁTICO.

Mide, sin producción ni datos de clientes:
  - que el motor no se caiga y el stream de Icecast no se corte (oyente real, huecos máximos),
  - silencios en muestras periódicas del stream (ffmpeg silencedetect),
  - transiciones del AutoMix y cuántas pistas salieron de la COLA DEL AGENTE,
  - memoria (RSS) del motor y del agente,
  - CAÍDA del agente (kill -9) a mitad de prueba: el audio debe seguir y el AutoMix mezclando,
  - REINICIO del agente: recupera la sesión y el control del motor y retoma la cola.

Uso (desde la raíz del repo, con el venv del agente):
  DUR=600 .venv/bin/python scripts/soak_agente_fase2.py          # validación de 10 min
  DUR=14400 .venv/bin/python scripts/soak_agente_fase2.py        # soak de 4 h
Variables: DUR (s) · SAMPLE (s, def 30) · CRASH_AT/RESTART_AT (fracción, def 0.40/0.55) ·
           REPORT (ruta del JSON) · TRACK_SECONDS (def 60) · TRANSITION (def 6).
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
SRV = ROOT / "build" / "audit_sound_server"
AGENT_DIR = ROOT / "services" / "dj-agent"
DUR = int(os.getenv("DUR", "600"))
SAMPLE = int(os.getenv("SAMPLE", "30"))
CRASH_AT = float(os.getenv("CRASH_AT", "0.40"))
RESTART_AT = float(os.getenv("RESTART_AT", "0.55"))
TRACK_SECONDS = int(os.getenv("TRACK_SECONDS", "60"))
TRANSITION = os.getenv("TRANSITION", "6")
ICE_PORT, ENG_PORT, AG_PORT = 18000, 18887, 18791
MOUNT, SRCPW = "/stream.mp3", "src_" + uuid.uuid4().hex[:8]
ENG_USER, ENG_PASS = "agente", "eng_" + uuid.uuid4().hex[:8]
OP = "tk-soak-" + uuid.uuid4().hex[:8]
BPMS = [118, 120, 122, 124, 124, 126, 126, 128, 128, 130, 122, 124]


def log(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def rss_kb(pid: int) -> int:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


class Listener(threading.Thread):
    """Oyente real del mount de Icecast: cuenta bytes, mide huecos y guarda ventanas para silencedetect."""

    def __init__(self, url: str):
        super().__init__(daemon=True)
        self.url, self.stop_ev = url, threading.Event()
        self.bytes, self.max_gap, self.reconnects, self.last = 0, 0.0, 0, time.time()
        self._capture: tuple[Path, float] | None = None
        self._lock = threading.Lock()

    def capture(self, path: Path, seconds: float) -> None:
        with self._lock:
            self._capture = (path, time.time() + seconds)

    def run(self) -> None:
        while not self.stop_ev.is_set():
            try:
                with httpx.stream("GET", self.url, timeout=httpx.Timeout(10, read=10)) as r:
                    for chunk in r.iter_bytes(4096):
                        now = time.time()
                        self.max_gap = max(self.max_gap, now - self.last)
                        self.last, self.bytes = now, self.bytes + len(chunk)
                        with self._lock:
                            cap = self._capture
                        if cap:
                            with open(cap[0], "ab") as f:
                                f.write(chunk)
                            if now >= cap[1]:
                                with self._lock:
                                    self._capture = None
                        if self.stop_ev.is_set():
                            return
            except httpx.HTTPError:
                pass
            if not self.stop_ev.is_set():
                self.reconnects += 1
                time.sleep(1)


def silences(mp3: Path) -> list[float]:
    out = subprocess.run(["ffmpeg", "-nostdin", "-hide_banner", "-i", str(mp3), "-af",
                          "silencedetect=noise=-50dB:d=2", "-f", "null", "-"], capture_output=True, text=True).stderr
    return [float(line.split("silence_duration: ")[1]) for line in out.splitlines() if "silence_duration" in line]


def main() -> int:
    if not SRV.exists() or not shutil.which("icecast2") or not shutil.which("ffmpeg"):
        print("SALTADO: falta build/audit_sound_server, icecast2 o ffmpeg")
        return 0
    tmp = Path(tempfile.mkdtemp(prefix="soak_f2_"))
    os.chmod(tmp, 0o777)
    music, logs = tmp / "music", tmp / "log"
    for d in (music, logs, tmp / "web"):
        d.mkdir()
        os.chmod(d, 0o777)
    log(f"generando {len(BPMS)} pistas sintéticas de {TRACK_SECONDS} s en {music}")
    for i, bpm in enumerate(BPMS):
        expr = f"0.7*sin(2*PI*55*t)*exp(-25*mod(t\\,60/{bpm}))+0.15*sin(2*PI*{110 * (i % 6 + 1)}*t)"
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                        f"aevalsrc='{expr}':s=44100:d={TRACK_SECONDS}", "-ac", "2",
                        str(music / f"soak_{i:02d}_{bpm}bpm.wav"), "-y"], check=True)

    chown = ""
    if os.getuid() == 0:
        group = next((g for g in ("nogroup", "nobody", "daemon")
                      if subprocess.run(["getent", "group", g], capture_output=True).returncode == 0), "nogroup")
        chown = f"<security><chroot>0</chroot><changeowner><user>nobody</user><group>{group}</group></changeowner></security>"
    (tmp / "icecast.xml").write_text(f"""<icecast><limits><clients>20</clients><sources>2</sources></limits>
<authentication><source-password>{SRCPW}</source-password><admin-user>admin</admin-user>
<admin-password>adm_{uuid.uuid4().hex[:6]}</admin-password></authentication><hostname>localhost</hostname>
<listen-socket><port>{ICE_PORT}</port></listen-socket>
<paths><logdir>{logs}</logdir><webroot>{tmp}/web</webroot><adminroot>{tmp}/web</adminroot></paths>
<logging><loglevel>2</loglevel></logging>{chown}</icecast>""")
    procs: dict[str, subprocess.Popen] = {}
    report: dict = {"dur_s": DUR, "sample_s": SAMPLE, "track_seconds": TRACK_SECONDS, "samples": [], "checks": {}}

    def stop_all() -> None:
        for name in ("agent", "engine", "icecast"):
            p = procs.get(name)
            if p and p.poll() is None:
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()

    try:
        procs["icecast"] = subprocess.Popen(["icecast2", "-c", str(tmp / "icecast.xml")],
                                            stdout=open(logs / "ice.out", "w"), stderr=subprocess.STDOUT)
        time.sleep(1.5)
        eng_env = {**os.environ, "AUDIT_SOUND_MUSIC_DIR": str(music), "AUDIT_SOUND_TRANSITION": TRANSITION,
                   "AUDIT_SOUND_ICECAST_HOST": "127.0.0.1", "AUDIT_SOUND_ICECAST_PORT": str(ICE_PORT),
                   "AUDIT_SOUND_ICECAST_MOUNT": MOUNT, "AUDIT_SOUND_ICECAST_USER": "source",
                   "AUDIT_SOUND_ICECAST_PASSWORD": SRCPW, "AUDIT_SOUND_API_USER": ENG_USER,
                   "AUDIT_SOUND_API_PASS": ENG_PASS, "AUDIT_SOUND_API_PORT": str(ENG_PORT)}
        eng_log = logs / "engine.log"
        procs["engine"] = subprocess.Popen([str(SRV)], env=eng_env, stdout=open(eng_log, "w"), stderr=subprocess.STDOUT)
        for _ in range(200):
            try:
                if httpx.get(f"http://127.0.0.1:{ENG_PORT}/api/status", timeout=1).status_code == 401:
                    break
            except httpx.HTTPError:
                time.sleep(0.25)
        listener = Listener(f"http://127.0.0.1:{ICE_PORT}{MOUNT}")
        listener.start()

        ag_db = tmp / "agent.db"
        ag_env = {**os.environ, "DJ_AGENT_DB_PATH": str(ag_db), "DJ_AGENT_ENGINE": "control_api",
                  "DJ_AGENT_ENGINE_URL": f"http://127.0.0.1:{ENG_PORT}", "DJ_AGENT_ENGINE_USER": ENG_USER,
                  "DJ_AGENT_ENGINE_PASS": ENG_PASS, "DJ_AGENT_DEV_TOKENS": f"{OP}:soak:operator:org1",
                  "DJ_AGENT_SCHEDULER_INTERVAL_SECONDS": "5"}
        uvicorn = Path(sys.executable).with_name("uvicorn")

        def start_agent() -> None:
            procs["agent"] = subprocess.Popen([str(uvicorn), "--factory", "app.main:create_app", "--host", "127.0.0.1",
                                               "--port", str(AG_PORT)], cwd=AGENT_DIR, env=ag_env,
                                              stdout=open(logs / "agent.log", "a"), stderr=subprocess.STDOUT)
            for _ in range(80):
                try:
                    if httpx.get(f"http://127.0.0.1:{AG_PORT}/api/v1/dj-agent/health", timeout=1).status_code == 200:
                        return
                except httpx.HTTPError:
                    time.sleep(0.25)
            raise RuntimeError("el agente no arrancó")

        A = f"http://127.0.0.1:{AG_PORT}/api/v1/dj-agent"
        H = {"Authorization": f"Bearer {OP}"}
        start_agent()
        sess = httpx.post(f"{A}/sessions", json={"name": "Soak F2", "mode": "AUTOMATICO"}, headers=H, timeout=10).json()
        sid = sess["id"]
        log(f"sesión {sid} · estado {sess['state']} · motor alcanzable {sess['engine']['reachable']}")

        t0 = time.time()
        crash_t, restart_t = t0 + DUR * CRASH_AT, t0 + DUR * RESTART_AT
        crashed = restarted = False
        trans_at_crash = bytes_at_crash = trans_at_restart = bytes_at_restart = 0
        silence_found: list[dict] = []
        next_capture = t0 + 60
        rss0 = None
        n_cap = 0
        while time.time() - t0 < DUR:
            time.sleep(SAMPLE)
            now = time.time()
            eng_txt = eng_log.read_text(errors="ignore")
            trans = eng_txt.count("automix: transición")
            from_queue = eng_txt.count("cola del agente →")
            alive = procs["engine"].poll() is None
            ag_alive = procs.get("agent") is not None and procs["agent"].poll() is None
            s = {"t": round(now - t0), "engine_alive": alive, "engine_rss_kb": rss_kb(procs["engine"].pid),
                 "agent_alive": ag_alive, "agent_rss_kb": rss_kb(procs["agent"].pid) if ag_alive else 0,
                 "stream_bytes": listener.bytes, "max_gap_s": round(listener.max_gap, 2),
                 "reconnects": listener.reconnects, "transitions": trans, "from_agent_queue": from_queue}
            if rss0 is None and now - t0 > 60:
                rss0 = s["engine_rss_kb"]
            report["samples"].append(s)
            log(f"t={s['t']:>5}s motor={'OK' if alive else 'CAÍDO'} rss={s['engine_rss_kb']}KB agente="
                f"{'OK' if ag_alive else '—'} stream={s['stream_bytes'] // 1024}KB hueco_max={s['max_gap_s']}s "
                f"trans={trans} cola_agente={from_queue}")
            if not alive:
                break
            if now >= next_capture:
                n_cap += 1
                cap = tmp / f"muestra_{n_cap:03d}.mp3"
                listener.capture(cap, 12)
                time.sleep(14)
                found = silences(cap) if cap.exists() else []
                if found:
                    silence_found.append({"t": s["t"], "silences": found})
                cap.unlink(missing_ok=True)
                next_capture = now + 300
            if not crashed and now >= crash_t:
                log("CAÍDA FORZADA DEL AGENTE (kill -9)")
                procs["agent"].kill()
                procs["agent"].wait()
                crashed, trans_at_crash, bytes_at_crash = True, trans, listener.bytes
            if crashed and not restarted and now >= restart_t:
                trans_at_restart, bytes_at_restart = trans, listener.bytes
                log("REINICIO DEL AGENTE (misma base: sesión y token del motor persistidos)")
                start_agent()
                restarted = True
                got = httpx.get(f"{A}/sessions/{sid}", headers=H, timeout=10).json()
                ack = httpx.post(f"{A}/sessions/{sid}/commands", json={"action": "set_transition",
                                                                       "params": {"value": float(TRANSITION)}},
                                 headers={**H, "Idempotency-Key": str(uuid.uuid4())}, timeout=10).json()
                report["checks"]["agente_reiniciado_recupera_sesion"] = got.get("id") == sid and got.get("state") == "PLAYING"
                report["checks"]["agente_reiniciado_comanda_motor"] = ack.get("status") == "ACKNOWLEDGED"
                log(f"tras reinicio: sesión {got.get('state')} · comando {ack.get('status')} {ack.get('error_code') or ''}")

        # ---- criterios ----
        last = report["samples"][-1] if report["samples"] else {}
        evs = []
        if restarted:
            ls = httpx.get(f"{A}/sessions/{sid}", headers=H, timeout=10).json().get("last_sequence", 0)
            after = max(0, ls - 500)
            while True:   # se pagina hasta el final: el soak largo genera miles de eventos
                page = httpx.get(f"{A}/sessions/{sid}/events?after={after}&limit=500", headers=H, timeout=10).json()
                evs += page
                if len(page) < 500:
                    break
                after = page[-1]["sequence"]
        rss_growth = round(100 * (last.get("engine_rss_kb", 0) - (rss0 or 1)) / (rss0 or 1), 1)
        expected_trans = int(DUR / TRACK_SECONDS * 0.7)
        c = report["checks"]
        c["motor_sin_caidas"] = all(x["engine_alive"] for x in report["samples"])
        c["stream_sin_cortes(hueco<5s)"] = listener.max_gap < 5 and listener.reconnects == 0
        c["sin_silencios_en_muestras"] = not silence_found
        c[f"transiciones>={expected_trans}"] = last.get("transitions", 0) >= expected_trans
        c["la_cola_del_agente_se_uso"] = last.get("from_agent_queue", 0) > 0
        c["sin_agente_el_automix_siguio"] = crashed and trans_at_restart > trans_at_crash
        c["sin_agente_el_audio_siguio"] = crashed and bytes_at_restart > bytes_at_crash
        c["agente_reiniciado_retoma_la_cola"] = any(e["type"] in ("queue.updated", "agent.autonomous.replan")
                                                    for e in evs if e.get("source") == "agent"
                                                    and e["timestamp"] >= restart_t)
        c["memoria_motor_estable(<50%)"] = rss_growth < 50
        report.update({"silences": silence_found, "rss_growth_pct": rss_growth, "max_gap_s": round(listener.max_gap, 2),
                       "stream_mb": round(listener.bytes / 1e6, 1), "transitions": last.get("transitions"),
                       "from_agent_queue": last.get("from_agent_queue"),
                       "agent_rss_kb_end": last.get("agent_rss_kb")})
        listener.stop_ev.set()
    finally:
        stop_all()
    ok = all(report["checks"].values()) and len(report["checks"]) >= 10
    report["result"] = "OK" if ok else "FALLA"
    out = Path(os.getenv("REPORT", str(tmp / "soak_report.json")))
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print("\n==== CRITERIOS ====")
    for k, v in report["checks"].items():
        print(f"  {'OK  ' if v else 'FALLA'} {k}")
    print(f"RESULTADO: {report['result']} · reporte: {out}")
    shutil.rmtree(tmp / "music", ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
