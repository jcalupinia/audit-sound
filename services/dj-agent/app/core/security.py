"""Autenticación (interfaz verificable) y principal autenticado.

``Authenticator`` es la interfaz: en producción se sustituirá por el IdP real
(p. ej. el portal/Command Center). En Fase 1 se entrega ``StaticTokenAuthenticator``,
de DESARROLLO, que lee tokens de ``DJ_AGENT_DEV_TOKENS`` y compara en tiempo constante.
El rol ``agent`` NO es autenticable por HTTP: es la identidad interna del agente.
"""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from typing import Protocol

from app.domain.models import Role

AGENT_ID = "dj-agent"


@dataclass(frozen=True)
class Principal:
    user_id: str
    role: Role
    org_id: str
    kind: str = "human"  # "human" | "agent"


def agent_principal(org_id: str) -> Principal:
    return Principal(user_id=AGENT_ID, role=Role.AGENT, org_id=org_id, kind="agent")


class Authenticator(Protocol):
    def authenticate(self, token: str) -> Principal | None: ...


class StaticTokenAuthenticator:
    """Tokens de desarrollo: ``token:usuario:rol:org;token2:usuario2:rol2:org2``."""

    def __init__(self, spec: str):
        self._entries: list[tuple[str, Principal]] = []
        for item in (spec or "").split(";"):
            parts = [p.strip() for p in item.split(":")]
            if len(parts) != 4 or not all(parts):
                continue
            token, user, role, org = parts
            try:
                r = Role(role)
            except ValueError:
                continue
            if r == Role.AGENT:
                continue  # nadie puede autenticarse como el agente
            self._entries.append((token, Principal(user_id=user, role=r, org_id=org)))

    def authenticate(self, token: str) -> Principal | None:
        if not token:
            return None
        found = None
        for known, principal in self._entries:
            if hmac.compare_digest(known.encode(), token.encode()):
                found = principal
        return found

    def __len__(self) -> int:
        return len(self._entries)
