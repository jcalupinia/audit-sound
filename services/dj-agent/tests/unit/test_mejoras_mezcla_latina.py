"""Mejoras de la biblioteca latina (2026-11-08): géneros del motor, no repetir la pista ya preparada
por el motor y ordenar por tempo."""

from __future__ import annotations

import httpx
import pytest

from app.adapters.engine_base import Track
from app.adapters.engine_control_api import ControlApiAdapter
from app.domain.models import DeckOut, EngineSnapshot
from app.orchestration.intent import parse_intent
from app.orchestration.planner import _tempo_gap, build_plan
from app.orchestration.session_manager import _cued


def _motor(req: httpx.Request) -> httpx.Response:
    if req.url.path == "/api/login":
        return httpx.Response(200, json={"token": "t", "youAreController": True})
    if req.url.path == "/api/tracks":
        return httpx.Response(200, json={"metadata": True, "tracks": [
            {"i": 0, "title": "Giovanny - Morena", "bpm": 135.0, "key": 7, "energy": 0.6, "duration": 215.7,
             "genre": "merengue"},
            {"i": 1, "title": "Sin genero", "bpm": 100.0, "key": 3, "energy": 0.5, "duration": 200.0}]})
    return httpx.Response(404)


def test_el_adaptador_lee_el_genero_que_publica_el_motor():
    a = ControlApiAdapter("http://engine:8787", "agente", "clave", transport=httpx.MockTransport(_motor))
    morena, otra = a.tracks()
    assert morena.genre == "merengue" and otra.genre is None


@pytest.mark.parametrize("texto,genero", [("pon merengue", "merengue"), ("ponme un mambo", "mambo"),
                                          ("quiero cha cha cha", "cha cha cha"), ("pon bachata", "bachata"),
                                          ("pon salsa", "salsa")])
def test_ordenes_de_generos_latinos(texto, genero):
    it = parse_intent(texto)
    assert it.intent == "CHANGE_GENRE" and it.parameters["genre"] == genero


LATINA = [Track(0, "Morena", 135.5, 7, 0.6, "merengue"), Track(1, "Cuban Boys", 100.0, 7, 0.6, "salsa"),
          Track(2, "Cuban Cigars", 119.7, 7, 0.6, "mambo"), Track(3, "Alentando", 99.0, 7, 0.6, "salsa"),
          Track(4, "Bachata Loca", 96.0, 7, 0.6, "bachata"), Track(5, "Cha Cha Man", 136.0, 7, 0.6, "cha cha cha"),
          Track(6, "Latino Soy", 200.0, 7, 0.6, "salsa")]


def test_plan_por_genero_con_la_biblioteca_latina():
    items, warnings = build_plan(LATINA, genre="salsa", count=3)
    assert {i.genre for i in items} == {"salsa"} and len(items) == 3 and not warnings


def test_el_tempo_ordena_el_plan():
    # Desde 100 BPM con la misma tonalidad y energía: primero la de 99 (o la de 200, doble tempo), nunca 135.
    items, _ = build_plan(LATINA, current=LATINA[1], count=3, history_ids=[1])
    assert items[0].bpm in (99.0, 200.0) and 135.5 not in [i.bpm for i in items[:2]]
    assert _tempo_gap(100, 200) == 0 and _tempo_gap(100, 50) == 0 and _tempo_gap(100, 135) > 0.3


def _snap(on_air: str, cued: str | None) -> EngineSnapshot:
    return EngineSnapshot(reachable=True, xfader=0.0, decks=[
        DeckOut(deck=0, title=on_air, loaded=True, playing=True),
        DeckOut(deck=1, title=cued or "", loaded=cued is not None, playing=False)])


def test_cued_es_la_pista_preparada_en_el_otro_deck():
    assert _cued(_snap("Morena", "Cuban Boys")).title == "Cuban Boys"
    assert _cued(_snap("Morena", None)) is None
