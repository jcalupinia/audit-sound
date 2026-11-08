#!/usr/bin/env python3
"""AUDIT SOUND · Ensayo local de títulos en el stream y del medidor de transiciones.

Levanta Icecast + el motor C++ REAL (build/audit_sound_server) con 4 pistas sintéticas de BPM y
títulos conocidos («Artista N - Tema X»), graba el stream como un oyente y comprueba:
  1. que el stream anuncia el título de cada pista (metadatos ICY) y que coincide con el archivo;
  2. que el medidor (scripts/medir_transiciones.py) ubica cada transición, mide un fundido cercano
     al configurado (AUDIT_SOUND_TRANSITION) y estima los BPM conocidos con error ≤ 3 %.

Uso (desde la raíz del repo): python3 scripts/ensayo_titulos_transiciones.py
Variables: TRACK_SECONDS (def 50) · TRANSITION (def 8) · GRABAR (s, def 170).
"""

from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import medir_transiciones as M  # noqa: E402

SRV = ROOT / "build" / "audit_sound_server"
TRACK_SECONDS = int(os.getenv("TRACK_SECONDS", "50"))
TRANSITION = os.getenv("TRANSITION", "8")
GRABAR = float(os.getenv("GRABAR", "170"))
ICE_PORT = 18000 + uuid.uuid4().int % 900
PISTAS = [("Artista Uno - Tema A", 120, 220), ("Artista Dos - Tema B", 124, 330),
          ("Artista Tres - Tema C", 128, 494), ("Artista Cuatro - Tema D", 122, 659)]


def main() -> int:
    if not SRV.exists() or not shutil.which("icecast2") or not shutil.which("ffmpeg"):
        print("SALTADO: falta build/audit_sound_server, icecast2 o ffmpeg")
        return 0
    tmp = Path(tempfile.mkdtemp(prefix="as_titulos_"))
    os.chmod(tmp, 0o755)   # Icecast corre como «nobody» y debe poder entrar
    music, logs = tmp / "music", tmp / "logs"
    for d in (music, logs, tmp / "web"):
        d.mkdir()
        os.chmod(d, 0o777)
    for k, (nombre, b, tono) in enumerate(PISTAS):
        # Cada pista con timbre propio, como canciones reales: bombo a `b` BPM, bajo y acorde en su
        # propia nota y platillos con su propia densidad (ruido filtrado a 1/2, 1/4 u 1/8 de compás).
        bajo = 41.2 * (1.5 ** (k % 3))
        hat = 60 / b / (2 ** (k % 3 + 1))
        expr = (f"0.5*sin(2*PI*50*t)*exp(-25*mod(t\\,60/{b}))"
                f"+0.30*sin(2*PI*{bajo:.1f}*t)*(0.6+0.4*sin(2*PI*t*{b}/60))"
                f"+0.22*sin(2*PI*{tono}*t)+0.16*sin(2*PI*{tono * 1.26:.1f}*t)+0.12*sin(2*PI*{tono * 1.5:.1f}*t)"
                f"+0.10*(random(0)-0.5)*exp(-60*mod(t\\,{hat:.4f}))")
        subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-f", "lavfi", "-i",
                        f"aevalsrc='{expr}':s=44100:d={TRACK_SECONDS}", "-af", "volume=0.8", "-ac", "2",
                        "-b:a", "192k", str(music / f"{nombre}.mp3"), "-y"], check=True)
    srcpw = "src_" + uuid.uuid4().hex[:8]
    chown = ""
    if os.getuid() == 0:
        chown = "<security><chroot>0</chroot><changeowner><user>nobody</user><group>nogroup</group></changeowner></security>"
    (tmp / "icecast.xml").write_text(f"""<icecast><limits><clients>10</clients><sources>2</sources></limits>
<authentication><source-password>{srcpw}</source-password><admin-user>admin</admin-user>
<admin-password>adm_{uuid.uuid4().hex[:6]}</admin-password></authentication><hostname>localhost</hostname>
<listen-socket><port>{ICE_PORT}</port></listen-socket>
<paths><logdir>{logs}</logdir><webroot>{tmp}/web</webroot><adminroot>{tmp}/web</adminroot></paths>
<logging><loglevel>2</loglevel></logging>{chown}</icecast>""")
    procs = []
    fallas = 0

    def ok(c: bool, m: str) -> None:
        nonlocal fallas
        print(("OK    " if c else "FALLA ") + m, flush=True)
        if not c:
            fallas += 1

    try:
        procs.append(subprocess.Popen(["icecast2", "-c", str(tmp / "icecast.xml")],
                                      stdout=open(logs / "ice.out", "w"), stderr=subprocess.STDOUT))
        time.sleep(1.5)
        env = {**os.environ, "AUDIT_SOUND_MUSIC_DIR": str(music), "AUDIT_SOUND_TRANSITION": TRANSITION,
               "AUDIT_SOUND_ICECAST_HOST": "127.0.0.1", "AUDIT_SOUND_ICECAST_PORT": str(ICE_PORT),
               "AUDIT_SOUND_ICECAST_MOUNT": "/stream.mp3", "AUDIT_SOUND_ICECAST_USER": "source",
               "AUDIT_SOUND_ICECAST_PASSWORD": srcpw}
        eng_log = open(logs / "engine.out", "w")
        procs.append(subprocess.Popen([str(SRV)], env=env, stdout=eng_log, stderr=subprocess.STDOUT))
        time.sleep(6)
        url = f"http://127.0.0.1:{ICE_PORT}/stream.mp3"
        os.environ["NO_PROXY"] = os.environ["no_proxy"] = "127.0.0.1,localhost"
        titulos, _ = M.grabar(url, GRABAR, tmp / "grabacion.mp3")
        r = M.analizar(tmp / "grabacion.mp3", titulos)
        (tmp / "transiciones.json").write_text(json.dumps(r, ensure_ascii=False, indent=2))
        print(M.markdown(r, url))
        nombres = {p[0] for p in PISTAS}
        vistos = [t["titulo"] for t in r["titulos"] if t["titulo"]]
        ok(len(vistos) >= 3, f"el stream anuncia títulos ({len(vistos)} anuncios)")
        ok(all(v in nombres for v in vistos), "cada título anunciado es el de un archivo de la biblioteca")
        log = (logs / "engine.out").read_text(errors="replace")
        ok("título del stream:" in log, "el motor registra «título del stream: …» en su log")
        med = [t for t in r["transiciones"] if t.get("medible")]
        ok(len(med) >= 2, f"transiciones medibles: {len(med)}")
        objetivo = float(TRANSITION)
        reales = [p[1] for p in PISTAS]
        for t in med:
            # El título se anuncia al TERMINAR el fundido: el cambio de sonido debe empezar unos
            # `objetivo` s antes del anuncio y no ser un corte.
            ok(1.5 <= t["fundido_s"] <= objetivo + 6,
               f"{t['de']} → {t['a']}: fundido {t['fundido_s']} s (configurado {objetivo:g} s; no es un corte)")
            empieza = t["t"] - t["fundido_desde_s"]
            ok(objetivo - 4 <= empieza <= objetivo + 4,
               f"{t['de']} → {t['a']}: el cambio empieza {empieza:.1f} s antes del anuncio del título")
            ok(t["bajon_db"] <= 6, f"{t['de']} → {t['a']}: sin bajón de volumen ({t['bajon_db']} dB)")
            for lado, v in (("saliente", t["bpm_saliente"]), ("entrante", t["bpm_entrante"])):
                # el motor iguala el tempo de la entrante con la saliente (syncTempo): se acepta
                # cualquier BPM de la sesión (± 3 %); la primera pista no fue resincronizada.
                ok(v is not None and min(abs(v - b) / b for b in reales) <= 0.03,
                   f"BPM {lado} de «{t['de'] if lado == 'saliente' else t['a']}»: {v} (BPM de la sesión: {reales})")
        primera = next((t for t in med if t["de"] == PISTAS[0][0]), None)
        if primera:
            ok(abs(primera["bpm_saliente"] - PISTAS[0][1]) / PISTAS[0][1] <= 0.03,
               f"BPM de la primera pista (sin resincronizar): {primera['bpm_saliente']} (real {PISTAS[0][1]})")
        print(f"\nevidencia: {tmp}/transiciones.json")
    finally:
        for p in reversed(procs):
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
                try:
                    p.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    p.kill()
    print("\nRESULTADO: " + ("OK" if not fallas else f"{fallas} FALLA(S)"))
    return 1 if fallas else 0


if __name__ == "__main__":
    sys.exit(main())
