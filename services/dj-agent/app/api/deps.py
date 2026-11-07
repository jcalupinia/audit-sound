"""Dependencias de FastAPI: principal autenticado, orquestador y correlación."""

from __future__ import annotations

from fastapi import Header, Request

from app.core.errors import AppError
from app.core.security import Principal
from app.orchestration.session_manager import SessionManager


def get_manager(request: Request) -> SessionManager:
    return request.app.state.manager


def get_principal(request: Request, authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError(401, "unauthorized", "Falta el token (cabecera Authorization: Bearer)")
    principal = request.app.state.auth.authenticate(authorization[7:].strip())
    if principal is None:
        raise AppError(401, "invalid_token", "Token inválido o caducado")
    return principal


def get_correlation_id(request: Request) -> str:
    return request.state.correlation_id
