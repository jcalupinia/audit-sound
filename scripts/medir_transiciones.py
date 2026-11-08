#!/usr/bin/env python3
"""AUDIT SOUND · Medidor de transiciones del stream en vivo (lo que escucha el oyente).

Graba el stream de Icecast con sus títulos (metadatos ICY «StreamTitle»), y por cada cambio de
canción mide sobre el AUDIO REAL:
  - cambio audible: cuánto tarda el sonido en pasar del perfil de la canción saliente al de la
    entrante (espectro de 0,5 s proyectado entre el de antes y el de después). Con el crossfader
    lineal del motor, la entrante domina antes de que termine el fundido configurado, así que el
    cambio audible suele ser más corto que AUDIT_SOUND_TRANSITION;
  - bajón de volumen: cuántos dB cae el audio durante el cambio respecto de las dos canciones;
  - BPM de la canción saliente y de la entrante (autocorrelación de los golpes) y su diferencia;
  - un veredicto en español: «mezcla suave», «fundido corto», «corte» o «bajón de volumen».

No necesita credenciales: solo la URL pública del stream. Escribe un informe JSON y uno Markdown.

Uso:
  python3 scripts/medir_transiciones.py                                    # producción, 10 min
  python3 scripts/medir_transiciones.py --url http://127.0.0.1:8000/stream.mp3 --segundos 200
Requiere ffmpeg y numpy. Respeta HTTPS_PROXY (urllib).
"""

from __future__ import annotations

import argparse
import http.client
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

SR = 11025          # frecuencia de análisis (suficiente para golpes y timbre)
HOP = 0.5           # resolución temporal de los perfiles (s)


def grabar(url: str, segundos: float, destino: Path) -> tuple[list[tuple[float, str]], int]:
    """Graba `segundos` de audio. Devuelve [(segundo_en_el_audio, título)] y el bitrate (bps)."""
    req = urllib.request.Request(url, headers={"Icy-MetaData": "1", "User-Agent": "audit-sound-medidor/1"})
    titulos: list[tuple[int, str]] = []
    audio = bytearray()
    with urllib.request.urlopen(req, timeout=20) as r:
        metaint = int(r.headers.get("icy-metaint") or 0)
        br = int((r.headers.get("icy-br") or "0").split(",")[0] or 0) * 1000
        fin = time.time() + segundos
        try:
            _leer(r, metaint, fin, audio, titulos)
        except (http.client.IncompleteRead, ConnectionError, TimeoutError, OSError) as e:
            # El stream se cortó (red o proxy): se analiza lo grabado hasta ahí, sin perderlo.
            print(f"aviso: la conexión se cortó tras {len(audio) * 8 / max(br, 1):.0f} s ({type(e).__name__}); "
                  "se analiza lo grabado", flush=True)
    destino.write_bytes(bytes(audio))
    if not br:
        out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=bit_rate", "-of", "csv=p=0",
                              str(destino)], capture_output=True, text=True).stdout.strip()
        br = int(out or 192000)
    return [(b * 8 / br, t) for b, t in titulos], br


def _leer(r, metaint: int, fin: float, audio: bytearray, titulos: list) -> None:
    while time.time() < fin:
        if metaint:
            audio += r.read(metaint)
            n = r.read(1)
            if not n:
                break
            ln = n[0] * 16
            if ln:
                meta = r.read(ln).rstrip(b"\0").decode("utf-8", "replace")
                if "StreamTitle='" in meta:
                    t = meta.split("StreamTitle='", 1)[1].split("';", 1)[0]
                    titulos.append((len(audio), t))
        else:
            chunk = r.read(16384)
            if not chunk:
                break
            audio += chunk


def decodificar(mp3: Path) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def perfiles(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Por cada ventana de HOP s: espectro logarítmico en bandas (timbre) y nivel en dBFS."""
    n = int(SR * HOP)
    frames = len(x) // n
    edges = np.geomspace(40, SR / 2 - 1, 25)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    bandas = np.zeros((frames, len(edges) - 1), dtype=np.float32)
    nivel = np.zeros(frames, dtype=np.float32)
    win = np.hanning(n)
    for i in range(frames):
        seg = x[i * n:(i + 1) * n]
        nivel[i] = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)
        sp = np.abs(np.fft.rfft(seg * win)) ** 2
        for b in range(len(edges) - 1):
            m = (freqs >= edges[b]) & (freqs < edges[b + 1])
            bandas[i, b] = 10 * np.log10(sp[m].sum() + 1e-12)
    return bandas, nivel


def bpm(x: np.ndarray) -> float | None:
    """BPM por autocorrelación de la envolvente de golpes (rango 70–180)."""
    if len(x) < SR * 6:
        return None
    hop = 256
    env = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    onset = np.maximum(np.diff(env), 0)
    if onset.std() < 1e-6:
        return None
    onset = (onset - onset.mean()) / onset.std()
    ac = np.correlate(onset, onset, mode="full")[len(onset) - 1:]
    fps = SR / hop
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 70)
    if hi >= len(ac):
        return None
    lag = lo + int(np.argmax(ac[lo:hi]))
    # refinamiento parabólico
    if 0 < lag < len(ac) - 1:
        a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
        den = a - 2 * b + c
        lag = lag + (0.5 * (a - c) / den if den else 0)
    return round(float(60 * fps / lag), 1)


def medir_transicion(x: np.ndarray, bandas: np.ndarray, nivel: np.ndarray, t: float, sig: float | None,
                     prev: float | None) -> dict:
    """Analiza el cambio anunciado en `t` (el título cambia al TERMINAR el fundido)."""
    f = lambda s: int(round(s / HOP))  # noqa: E731
    total = len(nivel)
    a0, a1 = max(f(prev + 2) if prev is not None else 0, f(t - 30)), f(t - 12)      # perfil de la saliente
    b0, b1 = f(t + 3), min(f(t + 18), f(sig - 12) if sig is not None else total, total)  # perfil de la entrante
    if a1 - a0 < 4 or b1 - b0 < 4:
        return {"t": round(t, 1), "medible": False, "motivo": "faltan segundos antes o después del cambio"}
    pa, pb = bandas[a0:a1].mean(0), bandas[b0:b1].mean(0)
    dv = pb - pa
    if float(np.dot(dv, dv)) < 1e-6:
        return {"t": round(t, 1), "medible": False, "motivo": "las dos canciones suenan igual (sin contraste)"}
    # Proyección de cada instante sobre la recta saliente→entrante: 0 = suena como la saliente,
    # 1 = como la entrante. Es robusta aunque ambas compartan instrumentos (p. ej. el bombo).
    w0, w1 = max(a1, f(t - 16)), min(b0 + 6, total)
    alfa = np.array([float(np.dot(bandas[max(i - 1, 0):i + 2].mean(0) - pa, dv) / np.dot(dv, dv))
                     for i in range(w0, w1)])
    arranca = np.nonzero(alfa > 0.15)[0]
    ini = w0 + (int(arranca[0]) if len(arranca) else 0)
    llega = np.nonzero(alfa[ini - w0:] >= 0.85)[0]
    fin = ini + (int(llega[0]) if len(llega) else len(alfa) - (ini - w0) - 1)
    fundido = max(0.0, (fin - ini) * HOP)
    base = float(np.median(np.concatenate([nivel[a0:a1], nivel[b0:b1]])))
    ventana = nivel[max(w0, ini - 2):min(w1, fin + 3)]
    bajon = float(base - ventana.min()) if len(ventana) else 0.0
    bpm_a = bpm(x[int(max(a0 * HOP, t - 27) * SR):int((t - 12) * SR)]) if t > 20 else None
    bpm_b = bpm(x[int((t + 3) * SR):int(b1 * HOP * SR)])
    dbpm = round(100 * abs(bpm_a - bpm_b) / bpm_a, 1) if bpm_a and bpm_b else None
    if bajon > 6:
        veredicto = "bajón de volumen"
    elif fundido < 1.5:
        veredicto = "corte"
    elif fundido < 2.5:
        veredicto = "fundido corto"
    else:
        veredicto = "mezcla suave"
    return {"t": round(t, 1), "medible": True, "fundido_s": round(fundido, 1),
            "fundido_desde_s": round(ini * HOP, 1), "fundido_hasta_s": round(fin * HOP, 1),
            "bajon_db": round(bajon, 1), "nivel_base_dbfs": round(base, 1),
            "bpm_saliente": bpm_a, "bpm_entrante": bpm_b, "diferencia_bpm_pct": dbpm, "veredicto": veredicto}


def analizar(mp3: Path, titulos: list[tuple[float, str]]) -> dict:
    x = decodificar(mp3)
    dur = len(x) / SR
    bandas, nivel = perfiles(x)
    cambios = []
    for i in range(1, len(titulos)):
        if titulos[i][1] != titulos[i - 1][1]:
            cambios.append(i)
    trans = []
    for k, i in enumerate(cambios):
        t = titulos[i][0]
        prev = titulos[cambios[k - 1]][0] if k > 0 else None
        sig = titulos[cambios[k + 1]][0] if k + 1 < len(cambios) else None
        m = medir_transicion(x, bandas, nivel, t, sig, prev)
        m["de"], m["a"] = titulos[i - 1][1], titulos[i][1]
        trans.append(m)
    silencio = float((nivel < -45).sum() * HOP)
    return {"duracion_s": round(dur, 1), "titulos": [{"t": round(t, 1), "titulo": s} for t, s in titulos],
            "transiciones": trans, "segundos_en_silencio": silencio,
            "nivel_medio_dbfs": round(float(nivel.mean()), 1)}


def markdown(r: dict, url: str) -> str:
    lin = [f"# Transiciones medidas en el stream\n", f"- Stream: `{url}`", f"- Duración grabada: {r['duracion_s']} s",
           f"- Silencio total (< −45 dBFS): {r['segundos_en_silencio']} s · nivel medio {r['nivel_medio_dbfs']} dBFS", ""]
    if not r["titulos"] or all(not t["titulo"] for t in r["titulos"]):
        lin.append("**El stream no anuncia títulos**: no se pueden ubicar los cambios de canción.\n")
    lin += ["| # | De → A | Cambio audible | Bajón | BPM saliente → entrante | Veredicto |", "|---|---|---|---|---|---|"]
    for i, t in enumerate(r["transiciones"], 1):
        if not t.get("medible"):
            lin.append(f"| {i} | {t['de']} → {t['a']} | — | — | — | no medible ({t['motivo']}) |")
            continue
        b = f"{t['bpm_saliente']} → {t['bpm_entrante']}" + (f" ({t['diferencia_bpm_pct']} %)" if t["diferencia_bpm_pct"] is not None else "")
        lin.append(f"| {i} | {t['de']} → {t['a']} | {t['fundido_s']} s | {t['bajon_db']} dB | {b} | {t['veredicto']} |")
    return "\n".join(lin) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default="https://audit-sound.audit-ia.ec/stream.mp3")
    ap.add_argument("--segundos", type=float, default=600)
    ap.add_argument("--salida", default="transiciones")
    a = ap.parse_args()
    out = Path(a.salida)
    out.mkdir(parents=True, exist_ok=True)
    mp3 = out / "grabacion.mp3"
    print(f"grabando {a.segundos:.0f} s de {a.url} …", flush=True)
    titulos, br = grabar(a.url, a.segundos, mp3)
    print(f"{len(titulos)} anuncios de título; bitrate {br // 1000} kbps", flush=True)
    r = analizar(mp3, titulos)
    (out / "transiciones.json").write_text(json.dumps(r, ensure_ascii=False, indent=2))
    md = markdown(r, a.url)
    (out / "transiciones.md").write_text(md)
    print(md)
    return 0


if __name__ == "__main__":
    sys.exit(main())
