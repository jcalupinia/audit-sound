"""Modelos de dominio y esquemas de la API (Pydantic v2)."""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Mode(StrEnum):
    MANUAL = "MANUAL"
    HIBRIDO = "HIBRIDO"
    AUTOMATICO = "AUTOMATICO"


class SessionState(StrEnum):
    CREATED = "CREATED"
    PREPARING = "PREPARING"
    READY = "READY"
    PLAYING = "PLAYING"
    PAUSED = "PAUSED"
    RECOVERING = "RECOVERING"
    STOPPED = "STOPPED"
    FAILED = "FAILED"


class AgentState(StrEnum):
    AVAILABLE = "AVAILABLE"
    DEGRADED = "DEGRADED"
    OFFLINE = "OFFLINE"


class CommandStatus(StrEnum):
    PROPOSED = "PROPOSED"
    ACCEPTED = "ACCEPTED"
    SENT = "SENT"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    REJECTED = "REJECTED"
    FAILED = "FAILED"


class ProposalStatus(StrEnum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class Role(StrEnum):
    ADMIN = "admin"
    OPERATOR = "operator"      # operador DJ
    SUPERVISOR = "supervisor"  # aprueba propuestas, no ejecuta comandos directos
    LISTENER = "listener"      # oyente: solo lectura
    AGENT = "agent"            # identidad interna del agente (no autenticable por HTTP)


class Origin(StrEnum):
    HUMAN = "human"
    AGENT = "agent"


# Máquina de estados de la sesión: transiciones permitidas.
SESSION_TRANSITIONS: dict[SessionState, set[SessionState]] = {
    SessionState.CREATED: {SessionState.PREPARING, SessionState.FAILED, SessionState.STOPPED},
    SessionState.PREPARING: {SessionState.READY, SessionState.RECOVERING, SessionState.FAILED, SessionState.STOPPED},
    SessionState.READY: {SessionState.PLAYING, SessionState.PAUSED, SessionState.RECOVERING, SessionState.STOPPED,
                         SessionState.FAILED},
    SessionState.PLAYING: {SessionState.PAUSED, SessionState.READY, SessionState.RECOVERING, SessionState.STOPPED,
                           SessionState.FAILED},
    SessionState.PAUSED: {SessionState.PLAYING, SessionState.READY, SessionState.RECOVERING, SessionState.STOPPED,
                          SessionState.FAILED},
    SessionState.RECOVERING: {SessionState.READY, SessionState.PLAYING, SessionState.PAUSED, SessionState.STOPPED,
                              SessionState.FAILED},
    SessionState.STOPPED: set(),
    SessionState.FAILED: set(),
}


def can_transition(src: SessionState, dst: SessionState) -> bool:
    return src == dst or dst in SESSION_TRANSITIONS[src]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---------- Entradas de la API ----------

class SessionCreate(_Strict):
    name: str = Field(min_length=1, max_length=120)
    mode: Mode = Mode.MANUAL


class ModeChange(_Strict):
    mode: Mode
    reason: str = Field(default="", max_length=300)
    expected_version: int | None = None


class CommandIn(_Strict):
    action: str = Field(min_length=1, max_length=40)
    params: dict[str, Any] = Field(default_factory=dict)
    expected_version: int | None = None


class IntentIn(_Strict):
    text: str = Field(min_length=1, max_length=1500)
    # Fase 6: de dónde vino el texto. «voice» = dictado del navegador (transcripción revisada por la
    # persona antes de enviarla). Se registra en la auditoría; no cambia los permisos de la orden.
    channel: Literal["text", "voice"] = "text"


class PlanRequest(_Strict):
    genre: str | None = Field(default=None, max_length=40)
    count: int = Field(default=8, ge=1, le=50)
    energy_trend: Literal["up", "down", "steady"] = "steady"
    duration_minutes: int | None = Field(default=None, ge=1, le=24 * 60)


class DecisionIn(_Strict):
    decision: Literal["approve", "reject"]
    reason: str = Field(default="", max_length=300)


class ControlRequest(_Strict):
    action: Literal["take", "release", "request", "approve", "deny", "force"]
    heartbeat: bool = False


class PreferencesIn(_Strict):
    approval_required: bool | None = None
    autonomy: int | None = Field(default=None, ge=0, le=100)
    model_route: Literal["auto", "qwen", "deepseek", "rules"] | None = None
    rules: dict[str, bool] | None = None
    hybrid_auto_actions: list[str] | None = None
    expected_version: int | None = None


# ---------- Salidas ----------

class DeckOut(BaseModel):
    deck: int
    title: str = ""
    track_id: int | None = None
    loaded: bool = False
    playing: bool = False
    pos: float = 0.0
    dur: float = 0.0
    bpm: float = 0.0
    key: int = -1


class EngineSnapshot(BaseModel):
    reachable: bool
    engine_mode: str = "auto"
    xfader: float = 0.5
    automix_state: int = 0
    transition_seconds: float = 8.0
    decks: list[DeckOut] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    queue: list[int] = Field(default_factory=list)       # Fase 2: cola del agente en el motor
    next_source: str | None = None                       # "agent" | "selector"
    error: str | None = None


class SessionOut(BaseModel):
    id: str
    org_id: str
    name: str
    mode: Mode
    state: SessionState
    agent_state: AgentState
    audio_authority: Literal["server"] = "server"
    version: int
    controller_id: str | None = None
    controller_expires_at: float | None = None
    pending_control_request: str | None = None
    last_sequence: int = 0
    engine: EngineSnapshot | None = None
    created_at: float
    updated_at: float


class CommandOut(BaseModel):
    id: str
    session_id: str
    action: str
    params: dict[str, Any]
    origin: Origin
    actor_id: str
    status: CommandStatus
    error_code: str | None = None
    error_message: str | None = None
    correlation_id: str
    idempotent_replay: bool = False
    proposal_id: str | None = None  # propuesta aprobada que lo originó (el historial no la duplica)
    created_at: float


class ProposalOut(BaseModel):
    id: str
    session_id: str
    kind: str
    summary: str
    commands: list[dict[str, Any]]
    requires_approval: bool
    status: ProposalStatus
    reason: str = ""
    decided_by: str | None = None
    created_at: float


class PlanOut(BaseModel):
    id: str
    session_id: str
    version: int
    status: str
    source: str
    constraints: dict[str, Any]
    items: list[dict[str, Any]]
    warnings: list[str] = Field(default_factory=list)
    created_by: str
    created_at: float


class IntentOut(BaseModel):
    intent: str
    parameters: dict[str, Any]
    confidence: float
    source: str
    fallback_reasons: list[str] = Field(default_factory=list)
    mode: Mode
    outcome: Literal["informational", "proposal", "executed", "rejected"]
    message: str
    proposal: ProposalOut | None = None
    commands: list[CommandOut] = Field(default_factory=list)
    plan: PlanOut | None = None
