"""Políticas: permisos por rol (RBAC) y reglas de autoridad del agente por modo.

- MANUAL: el agente solo observa; no ejecuta.
- HÍBRIDO: el agente propone; ejecuta sin aprobación SOLO lo autorizado en la política
  (y solo si la aprobación no está marcada como "Requerida").
- AUTOMÁTICO: el agente ejecuta dentro de los límites del nivel de autonomía.
  Las acciones peligrosas (pausar, cue, cargar sobre el plato al aire) siempre requieren
  aprobación humana, en cualquier modo.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.models import Mode, Role

PERMISSIONS: dict[str, frozenset[Role]] = {
    "session:create": frozenset({Role.ADMIN, Role.OPERATOR}),
    "session:read": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.LISTENER}),
    "session:close": frozenset({Role.ADMIN, Role.OPERATOR}),
    "session:mode": frozenset({Role.ADMIN, Role.OPERATOR}),
    "command:execute": frozenset({Role.ADMIN, Role.OPERATOR}),
    "control:take": frozenset({Role.ADMIN, Role.OPERATOR}),
    "voice:broadcast": frozenset({Role.ADMIN, Role.OPERATOR}),   # hablar por el micrófono al stream
    "control:force": frozenset({Role.ADMIN}),
    "intent:submit": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR}),
    "plan:request": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR}),
    "proposal:decide": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR}),
    "preferences:read": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR}),
    "preferences:write": frozenset({Role.ADMIN, Role.OPERATOR}),
    "usage:read": frozenset({Role.ADMIN, Role.SUPERVISOR}),
    "models:read": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR}),
    "events:subscribe": frozenset({Role.ADMIN, Role.OPERATOR, Role.SUPERVISOR, Role.LISTENER}),
    "audit:read": frozenset({Role.ADMIN, Role.SUPERVISOR}),
}


def has_permission(role: Role, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, frozenset())


# Acciones que el agente puede ejecutar en AUTOMÁTICO según el nivel de autonomía.
AUTONOMY_TIERS: list[tuple[int, frozenset[str]]] = [
    (0, frozenset({"queue_set", "queue_clear"})),                                  # 0–33: mantener la cola
    (34, frozenset({"queue_set", "queue_clear", "skip", "set_transition", "set_mixmode"})),  # 34–66
    (67, frozenset({"queue_set", "queue_clear", "skip", "set_transition", "set_mixmode",
                    "xfader", "eq", "filter", "gain", "rate", "deck_play"})),       # 67–100
]

DEFAULT_RULES = {"fallback": True, "silence": True, "noRepeat": True, "approval": True}


@dataclass
class SessionPolicy:
    approval_required: bool = True   # UI "Aprobación de acciones: Requerida"
    autonomy: int = 50               # UI slider 0–100
    model_route: str = "auto"
    rules: dict[str, bool] = field(default_factory=lambda: dict(DEFAULT_RULES))
    hybrid_auto_actions: list[str] = field(default_factory=list)
    max_skips_per_hour: int = 12

    def automatic_actions(self) -> frozenset[str]:
        allowed = AUTONOMY_TIERS[0][1]
        for threshold, actions in AUTONOMY_TIERS:
            if self.autonomy >= threshold:
                allowed = actions
        return allowed

    def to_dict(self) -> dict:
        return {"approval_required": self.approval_required, "autonomy": self.autonomy,
                "model_route": self.model_route, "rules": dict(self.rules),
                "hybrid_auto_actions": list(self.hybrid_auto_actions),
                "max_skips_per_hour": self.max_skips_per_hour}

    @staticmethod
    def from_dict(d: dict | None) -> SessionPolicy:
        d = d or {}
        rules = dict(DEFAULT_RULES)
        rules.update({k: bool(v) for k, v in (d.get("rules") or {}).items() if k in DEFAULT_RULES})
        return SessionPolicy(
            approval_required=bool(d.get("approval_required", True)),
            autonomy=int(d.get("autonomy", 50)),
            model_route=str(d.get("model_route", "auto")),
            rules=rules,
            hybrid_auto_actions=[str(a) for a in d.get("hybrid_auto_actions", [])],
            max_skips_per_hour=int(d.get("max_skips_per_hour", 12)),
        )


@dataclass(frozen=True)
class AgentDecision:
    allowed: bool            # ¿puede ejecutarse sin intervención humana?
    requires_approval: bool  # ¿debe convertirse en propuesta pendiente?
    reason: str


def agent_authority(mode: Mode, action: str, dangerous: bool, policy: SessionPolicy) -> AgentDecision:
    """Decide qué puede hacer el AGENTE con una acción en el modo actual."""
    if mode == Mode.MANUAL:
        return AgentDecision(True, False, "mode_manual_observe_only")  # MUTACION: no fusionar
    if dangerous:
        return AgentDecision(False, True, "dangerous_action_requires_human")
    if mode == Mode.HIBRIDO:
        if not policy.approval_required and action in policy.hybrid_auto_actions:
            return AgentDecision(True, False, "hybrid_auto_allowed_by_policy")
        return AgentDecision(False, True, "hybrid_requires_approval")
    # AUTOMÁTICO
    if action in policy.automatic_actions():
        return AgentDecision(True, False, "automatic_within_autonomy")
    return AgentDecision(False, True, "outside_autonomy_level")
