"""Batería de órdenes en español (Fase 3): lo que deben resolver las reglas, lo que se deja al modelo
y los intentos de inyección. El evaluador contra un modelo real es ``scripts/eval_intents_llm.py``."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.orchestration.intent import parse_intent

CASOS = json.loads((Path(__file__).parents[1] / "fixtures" / "casos_es.json").read_text(encoding="utf-8"))["casos"]


def coincide(it, caso) -> bool:
    if it.intent != caso["intent"] and it.intent not in caso.get("aceptables", []):
        return False
    return it.intent != caso["intent"] or all(it.parameters.get(k) == v for k, v in caso.get("params", {}).items())


def test_la_bateria_tiene_al_menos_30_casos_y_ids_unicos():
    assert len(CASOS) >= 30 and len({c["id"] for c in CASOS}) == len(CASOS)
    assert {c["via"] for c in CASOS} == {"rules", "llm", "injection"}


@pytest.mark.parametrize("caso", [c for c in CASOS if c["via"] == "rules"], ids=lambda c: c["id"])
def test_reglas_resuelven_sus_casos(caso):
    assert coincide(parse_intent(caso["text"]), caso), caso["text"]


@pytest.mark.parametrize("caso", [c for c in CASOS if c["via"] in ("llm", "injection")], ids=lambda c: c["id"])
def test_las_reglas_no_inventan_en_los_casos_del_modelo(caso):
    # Si las reglas no saben, deben decir UNKNOWN (así se consulta al modelo), nunca otra cosa.
    it = parse_intent(caso["text"])
    assert it.intent == "UNKNOWN" or coincide(it, caso), (caso["text"], it)
