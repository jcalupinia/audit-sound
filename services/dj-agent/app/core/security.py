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


class CommandCenterAuthenticator:
    """Login unificado (Fase 7): valida tokens de las Cuentas de Aplicaciones AUDIT-IA.

    Llama a ``GET {base}{me_path}`` del Command Center con el mismo token que la consola obtuvo
    al iniciar sesión. Solo acepta cuentas activas, con acceso a la app (``audit_sound``) y sin
    cambio de clave pendiente. El rol del agente sale de ``roles`` por correo
    (``correo:rol;*:rol``); quien no figure recibe ``default_role`` (por defecto solo lectura).
    Las respuestas se guardan en caché (``ttl``) para no consultar al Command Center en cada
    petición; un rechazo se recuerda poco tiempo (``negative_ttl``). Nunca se registra el token.
    """

    def __init__(self, base_url: str, *, app_key: str = "audit_sound", roles: str = "",
                 default_role: str = "listener", org: str = "auditconsulting", me_path: str = "/apps/auth/me",
                 timeout: float = 5.0, ttl: float = 60.0, negative_ttl: float = 10.0, max_cache: int = 1000,
                 transport: object | None = None, clock: object | None = None):
        import time as _time
        self._base = (base_url or "").rstrip("/")
        self._app, self._org, self._me = app_key, org, "/" + me_path.lstrip("/")
        self._timeout, self._ttl, self._neg, self._max = timeout, ttl, negative_ttl, max_cache
        self._transport, self._clock = transport, (clock or _time.monotonic)
        self._roles: dict[str, Role] = {}
        for item in (roles or "").split(";"):
            email, _, role = item.strip().rpartition(":")
            try:
                r = Role(role.strip())
            except ValueError:
                continue
            if email and r != Role.AGENT:
                self._roles[email.strip().lower()] = r
        try:
            self._default = Role(default_role)
        except ValueError:
            self._default = Role.LISTENER
        if self._default == Role.AGENT:
            self._default = Role.LISTENER
        self._cache: dict[str, tuple[float, Principal | None]] = {}

    @property
    def enabled(self) -> bool:
        return bool(self._base)

    def authenticate(self, token: str) -> Principal | None:
        if not self._base or not token or len(token) > 8192:
            return None
        import hashlib

        import httpx
        key = hashlib.sha256(token.encode()).hexdigest()
        now = self._clock()  # type: ignore[operator]
        hit = self._cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        principal: Principal | None = None
        cache_for = self._neg
        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as c:  # type: ignore[arg-type]
                r = c.get(self._base + self._me, headers={"Authorization": f"Bearer {token}"})
            if r.status_code == 200:
                me = r.json()
                email = str(me.get("email") or "").strip().lower()
                if email and self._app in (me.get("apps") or []) and not me.get("password_reset_required"):
                    role = self._roles.get(email) or self._roles.get("*") or self._default
                    principal = Principal(user_id=email, role=role, org_id=self._org)
                    cache_for = self._ttl
        except (httpx.HTTPError, ValueError):
            return None   # Command Center no disponible: no se cachea (se reintenta en la próxima petición)
        if len(self._cache) >= self._max:
            self._cache.clear()
        self._cache[key] = (now + cache_for, principal)
        return principal


class ChainAuthenticator:
    """Prueba varios autenticadores en orden (p. ej. llaves de respaldo y luego Command Center)."""

    def __init__(self, *auths: Authenticator):
        self._auths = [a for a in auths if a is not None]

    def authenticate(self, token: str) -> Principal | None:
        for a in self._auths:
            p = a.authenticate(token)
            if p is not None:
                return p
        return None
