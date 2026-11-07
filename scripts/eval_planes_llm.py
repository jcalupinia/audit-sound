#!/usr/bin/env python3
"""Evaluador de la Fase 4: planes multi-etapa con un LLM REAL (DeepSeek o Qwen, API compatible con OpenAI).

Mismo camino que el agente: resumen del catálogo (sin títulos) → prompt de planificación → extracción de
JSON → saneado → planificador determinista que elige las pistas del catálogo de PRUEBA (demo_catalog).

Variables: LLM_BASE_URL, LLM_MODEL, LLM_API_KEY (opcional; nunca se imprime), DJ_AGENT_LLM_TIMEOUT_SECONDS.
Uso: python scripts/eval_planes_llm.py [--reporte salida.json]
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "dj-agent"))

from app.adapters.engine_fake import demo_catalog  # noqa: E402
from app.adapters.llm import LLMError, OpenAICompatibleProvider  # noqa: E402
from app.orchestration.intent import parse_intent  # noqa: E402
from app.orchestration.llm_intent import extract_json  # noqa: E402
from app.orchestration.llm_plan import (  # noqa: E402
    RawPlanSpec,
    build_plan_messages,
    catalog_summary,
    sanitize_plan,
)
from app.orchestration.planner import build_plan  # noqa: E402

# (orden, géneros esperados en orden, tendencia esperada del primer/último bloque o None)
CASOS = [
    ("30 minutos de salsa y luego reguetón subiendo la energía", ["salsa", "reggaeton"], "up"),
    ("arranca suave con lounge para la cena y termina con techno a tope", ["lounge", "techno"], "up"),
    ("una hora: primero pop, después cumbia y cerramos con salsa", ["pop", "cumbia", "salsa"], None),
    ("algo tranquilo de deep house que vaya bajando para cerrar la noche", ["deep house"], "down"),
    ("set de 40 minutos de house que vaya subiendo", ["house"], "up"),
    ("empieza con reguetón y luego baja a lounge", ["reggaeton", "lounge"], "down"),
    ("quiero bachata 20 minutos y luego salsa", ["salsa"], None),          # bachata no está en el catálogo
    ("media hora de electrónica y media hora de latino", ["house", "salsa"], None),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reporte", default="")
    a = ap.parse_args()
    base, model = os.environ.get("LLM_BASE_URL", ""), os.environ.get("LLM_MODEL", "")
    if not base or not model:
        print("Falta LLM_BASE_URL o LLM_MODEL: no hay modelo que evaluar.")
        return 2
    prov = OpenAICompatibleProvider("eval", base, os.environ.get("LLM_API_KEY", ""), model)
    timeout = float(os.environ.get("DJ_AGENT_LLM_TIMEOUT_SECONDS", "30"))
    cat = demo_catalog()
    summary = catalog_summary(cat)
    filas, ok_n, lat = [], 0, []
    for text, exp_genres, exp_trend in CASOS:
        hint = parse_intent(text).parameters
        spec, err, ms = None, None, None
        try:
            res = prov.complete(build_plan_messages(text, summary, hint), timeout=timeout, max_tokens=500)
            ms = res.latency_ms
            lat.append(ms)
            spec = sanitize_plan(RawPlanSpec.model_validate(json.loads(extract_json(res.content))), cat)
            err = None if spec else "rechazado_por_validacion"
        except LLMError as exc:
            err = exc.code
        except ValueError:
            err = "salida_invalida"
        got = [s["genre"] for s in spec["segments"]] if spec else []
        # Las familias equivalentes cuentan (electrónica = house/deep house/techno; latino = salsa/cumbia/reggaeton).
        fam = {"house": "elec", "deep house": "elec", "techno": "elec", "salsa": "lat", "cumbia": "lat",
               "reggaeton": "lat", "lounge": "lounge", "pop": "pop"}
        genres_ok = [fam.get(g, g) for g in got[:len(exp_genres)]] == [fam.get(g, g) for g in exp_genres] or \
            (exp_genres == ["salsa"] and "salsa" in got)
        trends = [s["energy_trend"] for s in spec["segments"]] if spec else []
        trend_ok = exp_trend is None or exp_trend in trends or (spec and spec["energy_trend"] == exp_trend)
        items, _ = build_plan(cat, segments=spec["segments"] if spec else None) if spec else ([], [])
        ids_ok = all(i.track_id in {t.id for t in cat} for i in items)
        ok = bool(spec) and genres_ok and bool(trend_ok) and ids_ok
        ok_n += ok
        filas.append({"orden": text, "esperado": exp_genres, "obtenido": got, "tendencias": trends, "ok": ok,
                      "error": err, "pistas": len(items), "latencia_ms": round(ms, 1) if ms else None,
                      "nota": spec["note"] if spec else None})
        print(f"{'OK ' if ok else '-- '} {text[:60]:<60} → {got} {trends} {err or ''} {f'{ms:.0f} ms' if ms else ''}")
    lat.sort()
    resumen = {"modelo": model, "casos": len(CASOS), "aciertos": ok_n, "precision": round(ok_n / len(CASOS), 3),
               "latencia_ms_p50": round(lat[len(lat) // 2], 1) if lat else None,
               "latencia_ms_max": round(lat[-1], 1) if lat else None}
    print(json.dumps(resumen, ensure_ascii=False, indent=2))
    if a.reporte:
        Path(a.reporte).write_text(json.dumps({"resumen": resumen, "casos": filas}, ensure_ascii=False, indent=2),
                                   encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
