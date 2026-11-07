"""API REST v1 del agente DJ (prefijo /api/v1/dj-agent).

Toda operación que cambia estado exige ``Idempotency-Key`` (salvo crear sesión e intenciones,
donde es opcional). Las respuestas de error son ``{"error": {code, message, details, correlation_id}}``.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query, Request
from pydantic import BaseModel

from app import __version__
from app.api.deps import get_correlation_id, get_manager, get_principal
from app.core.security import Principal
from app.domain.models import (
    CommandIn,
    CommandOut,
    ControlRequest,
    DecisionIn,
    IntentIn,
    IntentOut,
    ModeChange,
    PlanOut,
    PlanRequest,
    PreferencesIn,
    ProposalOut,
    SessionCreate,
    SessionOut,
)
from app.orchestration.session_manager import SessionManager

router = APIRouter(prefix="/api/v1/dj-agent")

Manager = Annotated[SessionManager, Depends(get_manager)]
Auth = Annotated[Principal, Depends(get_principal)]
Corr = Annotated[str, Depends(get_correlation_id)]
IdemKey = Annotated[str | None, Header(alias="Idempotency-Key")]


class PlanResult(BaseModel):
    outcome: str
    message: str | None = None
    reason: str | None = None
    plan: PlanOut | None = None
    proposal: ProposalOut | None = None
    command: CommandOut | None = None


class DecisionResult(BaseModel):
    proposal: ProposalOut
    commands: list[dict[str, Any]]


@router.get("/health", tags=["salud"], summary="Liveness/readiness por dependencia (sin secretos)")
def health(request: Request) -> dict[str, Any]:
    m: SessionManager = request.app.state.manager
    snap = m._snapshot()
    db_ok = m.store.ping()
    return {"status": "ok" if db_ok and snap.reachable else "degraded", "version": __version__, "liveness": True,
            "readiness": {"db": db_ok,
                          "engine": {"kind": m.engine.name, "reachable": snap.reachable, "error": snap.error,
                                     "capabilities": snap.capabilities},
                          "models": m.router.status(),
                          "scheduler": m.settings.scheduler_enabled}}


@router.post("/sessions", status_code=201, response_model=SessionOut, tags=["sesiones"])
def create_session(body: SessionCreate, m: Manager, p: Auth, idem: IdemKey = None) -> dict[str, Any]:
    return m.create(p, body, idem)


@router.get("/sessions", response_model=list[SessionOut], tags=["sesiones"])
def list_sessions(m: Manager, p: Auth) -> list[SessionOut]:
    return m.list(p)


@router.get("/sessions/{sid}", response_model=SessionOut, tags=["sesiones"], summary="Estado autoritativo")
def get_session(sid: str, m: Manager, p: Auth) -> SessionOut:
    return m.get(sid, p)


@router.post("/sessions/{sid}/close", response_model=SessionOut, tags=["sesiones"])
def close_session(sid: str, m: Manager, p: Auth, corr: Corr, idem: IdemKey = None) -> dict[str, Any]:
    return m.close(sid, p, idem, corr)


@router.post("/sessions/{sid}/mode", response_model=SessionOut, tags=["sesiones"],
             summary="Cambiar MANUAL/HIBRIDO/AUTOMATICO sin reiniciar el motor")
def change_mode(sid: str, body: ModeChange, m: Manager, p: Auth, corr: Corr, idem: IdemKey = None) -> dict[str, Any]:
    return m.change_mode(sid, p, body, idem, corr)


@router.post("/sessions/{sid}/control", response_model=SessionOut, tags=["sesiones"],
             summary="Lease de control: take/release/request/approve/deny/force")
def control(sid: str, body: ControlRequest, m: Manager, p: Auth, corr: Corr) -> SessionOut:
    return m.control(sid, p, body, corr)


@router.post("/sessions/{sid}/commands", response_model=CommandOut, tags=["comandos"],
             summary="Ejecutar un comando permitido (ACK real del motor)")
def submit_command(sid: str, body: CommandIn, m: Manager, p: Auth, corr: Corr, idem: IdemKey = None) -> dict[str, Any]:
    return m.submit_command(sid, p, body, idem, corr)


@router.get("/sessions/{sid}/commands", response_model=list[CommandOut], tags=["comandos"])
def list_commands(sid: str, m: Manager, p: Auth) -> list[dict[str, Any]]:
    return m.list_commands(sid, p)


@router.post("/sessions/{sid}/intent", response_model=IntentOut, tags=["agente"],
             summary="Interpretar una instrucción en español")
def submit_intent(sid: str, body: IntentIn, m: Manager, p: Auth, corr: Corr) -> dict[str, Any]:
    return m.submit_intent(sid, p, body, corr)


@router.post("/sessions/{sid}/plans", response_model=PlanResult, tags=["agente"],
             summary="Solicitar un plan (no se ejecuta de forma implícita fuera de la política)")
def request_plan(sid: str, body: PlanRequest, m: Manager, p: Auth, corr: Corr) -> dict[str, Any]:
    return m.request_plan(sid, p, body, corr)


@router.get("/sessions/{sid}/plans/current", response_model=PlanOut, tags=["agente"])
def current_plan(sid: str, m: Manager, p: Auth) -> PlanOut:
    return m.current_plan(sid, p)


@router.get("/sessions/{sid}/proposals", response_model=list[ProposalOut], tags=["agente"])
def list_proposals(sid: str, m: Manager, p: Auth, status: str | None = None) -> list[dict[str, Any]]:
    return m.list_proposals(sid, p, status)


@router.post("/sessions/{sid}/proposals/{pid}/decision", response_model=DecisionResult, tags=["agente"])
def decide(sid: str, pid: str, body: DecisionIn, m: Manager, p: Auth, corr: Corr,
           idem: IdemKey = None) -> dict[str, Any]:
    return m.decide(sid, pid, p, body, idem, corr)


@router.get("/sessions/{sid}/preferences", tags=["agente"])
def get_preferences(sid: str, m: Manager, p: Auth) -> dict[str, Any]:
    return m.get_prefs(sid, p)


@router.put("/sessions/{sid}/preferences", tags=["agente"])
def put_preferences(sid: str, body: PreferencesIn, m: Manager, p: Auth, corr: Corr) -> dict[str, Any]:
    return m.put_prefs(sid, p, body, corr)


@router.get("/sessions/{sid}/events", tags=["eventos"], summary="Auditoría y replay REST de eventos")
def list_events(sid: str, m: Manager, p: Auth, after: Annotated[int, Query(ge=0)] = 0,
                limit: Annotated[int, Query(ge=1, le=500)] = 200) -> list[dict[str, Any]]:
    return m.events(sid, p, after, limit)


@router.get("/models/status", tags=["agente"], summary="Salud de Qwen/DeepSeek (sin secretos)")
def models_status(m: Manager, p: Auth) -> list[dict[str, Any]]:
    m.require(p, "models:read")
    return m.router.status()


@router.get("/usage", tags=["agente"], summary="Consumo de IA (estimación rotulada)")
def usage(m: Manager, p: Auth) -> dict[str, Any]:
    return m.usage(p)


@router.get("/catalog/tracks", tags=["catálogo"], summary="Catálogo del motor y disponibilidad de metadatos")
def catalog(m: Manager, p: Auth) -> dict[str, Any]:
    return m.catalog(p)
