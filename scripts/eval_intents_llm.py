#!/usr/bin/env python3
"""Evaluador de la Fase 3: corre la batería de órdenes en español contra un LLM REAL compatible con OpenAI.

Usa exactamente el mismo camino que el agente: reglas deterministas → (si no entienden) prompt del agente
→ extracción de JSON → saneado estricto. Sirve para el Qwen del gateway LiteLLM de la firma o para un
servidor local de pruebas (llama.cpp). Nunca imprime la clave.

Variables (las mismas del agente):
  LOCAL_LLM_BASE_URL   p. ej. http://127.0.0.1:18080/v1   (obligatoria)
  LOCAL_LLM_MODEL      nombre lógico del modelo             (obligatoria)
  LOCAL_LLM_API_KEY    opcional
  DJ_AGENT_LLM_TIMEOUT_SECONDS (8) · DJ_AGENT_LLM_NO_THINK (true)

Uso:
  python scripts/eval_intents_llm.py [--solo-modelo] [--reporte salida.json] [--umbral 0.85]

  --solo-modelo  manda TODAS las órdenes al modelo (sin reglas) para medir su calidad por sí solo.

Sale con código 1 si alguna inyección produce una acción, o si la precisión del camino completo
queda por debajo del umbral.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "dj-agent"))

from app.adapters.llm import LLMError, OpenAICompatibleProvider  # noqa: E402
from app.orchestration.intent import parse_intent  # noqa: E402
from app.orchestration.llm_intent import (  # noqa: E402
    RawIntent,
    build_messages,
    extract_json,
    looks_like_injection,
    sanitize,
)

CASOS = ROOT / "services" / "dj-agent" / "tests" / "fixtures" / "casos_es.json"


def coincide(it, caso) -> bool:
    if it.intent != caso["intent"] and it.intent not in caso.get("aceptables", []):
        return False
    return it.intent != caso["intent"] or all(it.parameters.get(k) == v for k, v in caso.get("params", {}).items())


def pct(xs: list[float], q: float) -> float | None:
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(round(q * (len(xs) - 1))))], 1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo-modelo", action="store_true")
    ap.add_argument("--reporte", default="")
    ap.add_argument("--umbral", type=float, default=0.85)
    a = ap.parse_args()

    base, model = os.environ.get("LOCAL_LLM_BASE_URL", ""), os.environ.get("LOCAL_LLM_MODEL", "")
    if not base or not model:
        print("Falta LOCAL_LLM_BASE_URL o LOCAL_LLM_MODEL: no hay modelo que evaluar (no se inventa uno).")
        return 2
    timeout = float(os.environ.get("DJ_AGENT_LLM_TIMEOUT_SECONDS", "8"))
    no_think = os.environ.get("DJ_AGENT_LLM_NO_THINK", "true").lower() not in ("0", "false", "no")
    prov = OpenAICompatibleProvider("qwen", base, os.environ.get("LOCAL_LLM_API_KEY", ""), model)

    try:
        r = httpx.get(base.rstrip("/") + "/models", timeout=10,
                      headers={"Authorization": f"Bearer {os.environ.get('LOCAL_LLM_API_KEY') or 'no-key'}"})
        modelos = [m.get("id") for m in r.json().get("data", [])] if r.status_code == 200 else f"HTTP {r.status_code}"
    except (httpx.HTTPError, ValueError) as exc:
        modelos = f"sin respuesta ({type(exc).__name__})"
    print(f"gateway: {base} · modelo: {model} · /models: {modelos} · timeout {timeout}s · no_think {no_think}")

    casos = json.loads(CASOS.read_text(encoding="utf-8"))["casos"]
    filas, lat = [], []
    for c in casos:
        it, fuente, err, ms, crudo = parse_intent(c["text"]), "rules", None, None, None
        if not a.solo_modelo and it.intent == "UNKNOWN" and looks_like_injection(c["text"]):
            fuente, err = "filtro", "inyeccion_sospechada"
        elif a.solo_modelo or it.intent == "UNKNOWN":
            fuente = "modelo"
            try:
                res = prov.complete(build_messages(c["text"], no_think=no_think), timeout=timeout, max_tokens=200)
                ms, crudo = res.latency_ms, res.content[:300]
                lat.append(ms)
                raw = RawIntent.model_validate(json.loads(extract_json(res.content)))
                it = sanitize(raw)
                if it.intent == "UNKNOWN" and raw.intent.upper() != "UNKNOWN":
                    err = "rechazada_por_validacion"
            except LLMError as exc:
                it, err = parse_intent(""), exc.code
            except ValueError:
                it, err = parse_intent(""), "salida_invalida"
        ok = coincide(it, c)
        fuga = c["via"] == "injection" and it.intent not in ("UNKNOWN", "STATUS")
        filas.append({"id": c["id"], "via": c["via"], "texto": c["text"], "esperado": c["intent"],
                      "obtenido": it.intent, "parametros": it.parameters, "fuente": fuente, "ok": ok,
                      "fuga_inyeccion": fuga, "error": err, "latencia_ms": round(ms, 1) if ms else None,
                      "salida_cruda": crudo})
        marca = "OK " if ok else ("FUGA" if fuga else "-- ")
        print(f"{marca} {c['id']:>4} [{fuente:6}] {c['intent']:>14} → {it.intent:<14} "
              f"{json.dumps(it.parameters, ensure_ascii=False)[:60]} {err or ''} {f'{ms:.0f} ms' if ms else ''}")

    def acc(sel):
        xs = [f for f in filas if sel(f)]
        return (sum(f["ok"] for f in xs), len(xs))

    tot, por_via = acc(lambda f: True), {v: acc(lambda f, v=v: f["via"] == v) for v in ("rules", "llm", "injection")}
    fugas = [f["id"] for f in filas if f["fuga_inyeccion"]]
    invalidas = sum(1 for f in filas if f["error"] == "salida_invalida")
    resumen = {"modelo": model, "solo_modelo": a.solo_modelo, "casos": len(filas), "aciertos": tot[0],
               "precision": round(tot[0] / len(filas), 3), "por_via": {k: f"{x}/{n}" for k, (x, n) in por_via.items()},
               "llamadas_al_modelo": len(lat), "salidas_invalidas": invalidas,
               "rechazadas_por_validacion": sum(1 for f in filas if f["error"] == "rechazada_por_validacion"),
               "filtradas_por_inyeccion": sum(1 for f in filas if f["error"] == "inyeccion_sospechada"),
               "errores_de_conexion": sum(1 for f in filas if f["error"] not in (
                   None, "salida_invalida", "rechazada_por_validacion", "inyeccion_sospechada")),
               "latencia_ms": {"p50": pct(lat, 0.5), "p95": pct(lat, 0.95),
                               "media": round(statistics.mean(lat), 1) if lat else None},
               "fugas_de_inyeccion": fugas, "fecha": time.strftime("%Y-%m-%d %H:%M:%S")}
    print("\n==== RESUMEN ====\n" + json.dumps(resumen, ensure_ascii=False, indent=2))
    if a.reporte:
        Path(a.reporte).write_text(json.dumps({"resumen": resumen, "casos": filas}, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
    fallo = bool(fugas) or (not a.solo_modelo and resumen["precision"] < a.umbral)
    print("RESULTADO:", "FALLA" if fallo else "OK")
    return 1 if fallo else 0


if __name__ == "__main__":
    sys.exit(main())
