"""Planificador (solo pistas del catálogo) y motor simulado (continuidad, cola y respaldo)."""

from __future__ import annotations

import pytest

from app.adapters.engine_base import EngineCapabilityError, EngineError
from app.adapters.engine_fake import FakeEngine, demo_catalog
from app.orchestration.planner import build_plan


def test_plan_solo_usa_ids_del_catalogo_y_no_repite():
    cat = demo_catalog()
    ids = {t.id for t in cat}
    items, _ = build_plan(cat, count=10, history_ids=[0, 1])
    assert items and all(i.track_id in ids for i in items)
    assert len({i.track_id for i in items}) == len(items)
    assert not {0, 1} & {i.track_id for i in items}


def test_plan_por_genero_y_bloques():
    cat = demo_catalog()
    items, warnings = build_plan(cat, segments=[{"genre": "salsa", "minutes": 9}, {"genre": "reggaeton", "minutes": 6}])
    genres = [i.genre for i in items]
    assert genres[:3] == ["salsa"] * 3 and set(genres[3:]) == {"reggaeton"}
    assert not warnings


def test_plan_energia_ascendente():
    cat = demo_catalog()
    items, _ = build_plan(cat, current=cat[16], count=8, energy_trend="up")  # parte de lounge (0.30)
    assert items[-1].energy > items[0].energy


def test_genero_inexistente_lo_declara_sin_inventar():
    items, warnings = build_plan(demo_catalog(), genre="ópera")
    assert items == [] and any("genero_sin_pistas" in w for w in warnings)


def test_sin_metadatos_degrada_con_confianza_baja():
    eng = FakeEngine(emulate_current_engine=True)
    items, warnings = build_plan(eng.tracks(), genre="salsa", count=3)
    assert len(items) == 3 and all(i.confidence == 0.2 for i in items)
    assert any("metadatos_no_disponibles_B1" in w for w in warnings)


def test_motor_simulado_una_hora_sin_silencio_ni_reinicio():
    eng = FakeEngine()
    eng.advance(3600)
    assert eng.transitions >= 15 and eng.silence_seconds == 0.0
    assert eng.restart_count == 0 and eng.stream_epoch == 1


def test_cola_del_agente_tiene_prioridad_y_luego_vuelve_al_selector():
    eng = FakeEngine()
    eng.execute("queue_set", {"track_ids": [12, 13]})
    eng.advance(180 * 4)
    assert eng.history[1:3] == [12, 13]         # primero la cola del agente
    assert len(eng.history) >= 4                # después AutoMix sigue con su selector
    assert eng.silence_seconds == 0.0


def test_motor_actual_no_admite_cola_ni_metadatos():
    eng = FakeEngine(emulate_current_engine=True)
    assert "queue" not in eng.capabilities() and not eng.tracks()[0].has_metadata
    with pytest.raises(EngineCapabilityError):
        eng.execute("queue_set", {"track_ids": [1]})


def test_modo_manual_del_motor_no_detiene_el_plato_al_aire():
    eng = FakeEngine()
    eng.advance(10)
    pos = eng.decks[0].pos
    eng.set_engine_mode("manual")
    eng.advance(5)
    assert eng.decks[0].playing and eng.decks[0].pos > pos and eng.decks[0].track_id == 0
    assert eng.xfader == 0.0   # Fase 2: con un plato sonando, set_mode_dj ya no mueve el crossfader


def test_motor_inalcanzable_lanza_error_tipado():
    eng = FakeEngine()
    eng.set_reachable(False)
    with pytest.raises(EngineError) as exc:
        eng.status()
    assert exc.value.code == "engine_unreachable"


def test_no_repetir_no_deja_sin_candidatas_en_un_catalogo_pequeno():
    cat = demo_catalog()[:6]
    items, _ = build_plan(cat, count=3, history_ids=[0, 1, 2, 3, 4, 5, 0, 1])  # todo el catálogo ya sonó
    assert len(items) == 3 and not {0, 1, 5} & {i.track_id for i in items}   # evita las 3 más recientes
