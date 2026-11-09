"""Lista blanca (allowlist) de comandos del motor y validación de parámetros.

Refleja las acciones VERIFICADAS de la Control API C++ (engine/api/control_api.cpp:420)
más las de la Fase 2 (cola del agente), marcadas con la capacidad que requieren.
Cualquier acción o campo desconocido se rechaza (extra="forbid").
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.core.errors import invalid


class _P(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DeckP(_P):
    deck: int = Field(ge=0, le=1)


class DeckLoadP(DeckP):
    track: int = Field(ge=0)
    confirm: bool = False  # obligatorio para cargar sobre el plato que está sonando


class ValueXfader(_P):
    value: float = Field(ge=0.0, le=1.0)


class EqP(DeckP):
    low: float = Field(default=0.0, ge=-12.0, le=12.0)
    mid: float = Field(default=0.0, ge=-12.0, le=12.0)
    high: float = Field(default=0.0, ge=-12.0, le=12.0)


class DeckValue(DeckP):
    value: float


class FilterP(DeckP):
    value: float = Field(ge=-1.0, le=1.0)


class GainP(DeckP):
    value: float = Field(ge=0.0, le=2.0)


class RateP(DeckP):
    value: float = Field(ge=0.8, le=1.2)


class EmptyP(_P):
    pass


class TransitionP(_P):
    value: float = Field(ge=1.0, le=30.0)


class MixModeP(_P):
    value: int = Field(ge=0, le=1)  # 0 = salta silencios, 1 = pista completa


class FxP(_P):
    """Banco de efectos del motor (eco, delay, reverb, filtro, flanger, phaser, bitcrush)."""
    bank: int = Field(ge=1, le=2)
    type: Literal["none", "echo", "delay", "reverb", "filter", "flanger", "phaser", "crush"] | None = None
    target: Literal["A", "B", "master"] | None = None
    on: bool | None = None
    wet: float | None = Field(default=None, ge=0.0, le=1.0)
    param: float | None = Field(default=None, ge=0.0, le=1.0)
    sync: bool | None = None


class QueueSetP(_P):
    track_ids: list[int] = Field(min_length=1, max_length=50)


class CommandSpec(BaseModel):
    action: str
    engine_action: str
    params_model: type[_P]
    dangerous: bool = False          # puede cortar o detener el audio al aire
    capability: str | None = None    # capacidad del motor requerida (p. ej. "queue")
    internal: bool = False           # no se acepta desde la API pública


SPECS: dict[str, CommandSpec] = {s.action: s for s in [
    CommandSpec(action="deck_load", engine_action="deck_load", params_model=DeckLoadP, dangerous=True),
    CommandSpec(action="deck_play", engine_action="deck_play", params_model=DeckP),
    CommandSpec(action="deck_pause", engine_action="deck_pause", params_model=DeckP, dangerous=True),
    CommandSpec(action="deck_cue", engine_action="deck_cue", params_model=DeckP, dangerous=True),
    CommandSpec(action="deck_set_cue", engine_action="deck_set_cue", params_model=DeckP),
    CommandSpec(action="xfader", engine_action="xfader", params_model=ValueXfader),
    CommandSpec(action="eq", engine_action="eq", params_model=EqP),
    CommandSpec(action="filter", engine_action="filter", params_model=FilterP),
    CommandSpec(action="gain", engine_action="gain", params_model=GainP),
    CommandSpec(action="rate", engine_action="rate", params_model=RateP),
    CommandSpec(action="skip", engine_action="skip", params_model=EmptyP),
    CommandSpec(action="set_transition", engine_action="set_transition", params_model=TransitionP),
    # 'set_mode' en el motor es el modo de AutoMix (no el modo DJ): lo renombramos.
    CommandSpec(action="set_mixmode", engine_action="set_mode", params_model=MixModeP),
    # Efectos de audio: solo personas (no está en los niveles de autonomía del agente).
    CommandSpec(action="fx", engine_action="fx", params_model=FxP, capability="fx"),
    # Fase 2 (no existe aún en el motor real → capacidad "queue", brecha B2)
    CommandSpec(action="queue_set", engine_action="queue_set", params_model=QueueSetP, capability="queue"),
    CommandSpec(action="queue_clear", engine_action="queue_clear", params_model=EmptyP, capability="queue"),
]}


def validate_command(action: str, params: dict[str, Any], *, allow_internal: bool = False) -> tuple[CommandSpec, dict]:
    spec = SPECS.get(action)
    if spec is None or (spec.internal and not allow_internal):
        raise invalid("unknown_action", f"Acción no permitida: {action!r}", allowed=sorted(SPECS))
    try:
        model = spec.params_model.model_validate(params)
    except ValidationError as exc:
        raise invalid("invalid_params", "Parámetros fuera de rango o no permitidos",
                      errors=[{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]) from exc
    return spec, model.model_dump()
