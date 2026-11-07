"""Errores de aplicación con código de máquina y mensaje humano (en español)."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


def not_found(what: str) -> AppError:
    # 404 también para recursos de otra organización: no revela su existencia.
    return AppError(404, "not_found", f"{what} no encontrado")


def forbidden(permission: str) -> AppError:
    return AppError(403, "forbidden", "Tu rol no tiene permiso para esta operación", {"permission": permission})


def conflict(code: str, message: str, **details: Any) -> AppError:
    return AppError(409, code, message, details)


def invalid(code: str, message: str, **details: Any) -> AppError:
    return AppError(422, code, message, details)
