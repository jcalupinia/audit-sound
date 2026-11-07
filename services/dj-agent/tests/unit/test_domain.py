"""Unitarias: máquina de estados, RBAC, política por modo, validación de comandos, Camelot y redacción."""

from __future__ import annotations

import logging

import pytest

from app.core.errors import AppError
from app.core.logging import RedactingFilter, redact
from app.core.security import StaticTokenAuthenticator
from app.core.settings import Settings
from app.domain.commands import validate_command
from app.domain.models import Mode, Role, SessionState, can_transition
from app.domain.music import camelot, keys_compatible
from app.domain.policies import PERMISSIONS, SessionPolicy, agent_authority, has_permission


def test_maquina_de_estados_transiciones_validas_e_invalidas():
    assert can_transition(SessionState.CREATED, SessionState.PREPARING)
    assert can_transition(SessionState.PLAYING, SessionState.RECOVERING)
    assert can_transition(SessionState.RECOVERING, SessionState.PLAYING)
    assert not can_transition(SessionState.STOPPED, SessionState.PLAYING)   # terminal
    assert not can_transition(SessionState.FAILED, SessionState.READY)
    assert not can_transition(SessionState.CREATED, SessionState.PLAYING)  # debe pasar por PREPARING


def test_rbac_matriz():
    assert has_permission(Role.OPERATOR, "command:execute")
    assert not has_permission(Role.SUPERVISOR, "command:execute")  # supervisa, no ejecuta directo
    assert has_permission(Role.SUPERVISOR, "proposal:decide")
    assert not has_permission(Role.LISTENER, "intent:submit")
    assert has_permission(Role.LISTENER, "session:read")
    assert has_permission(Role.ADMIN, "control:force") and not has_permission(Role.OPERATOR, "control:force")
    assert all(Role.AGENT not in roles for roles in PERMISSIONS.values())  # el agente no tiene permisos HTTP


@pytest.mark.parametrize("mode,action,dangerous,allowed,approval", [
    (Mode.MANUAL, "skip", False, False, False),
    (Mode.HIBRIDO, "skip", False, False, True),
    (Mode.AUTOMATICO, "skip", False, True, False),
    (Mode.AUTOMATICO, "deck_pause", True, False, True),
    (Mode.AUTOMATICO, "eq", False, False, True),     # autonomía 50 no incluye EQ
])
def test_autoridad_del_agente_por_modo(mode, action, dangerous, allowed, approval):
    d = agent_authority(mode, action, dangerous, SessionPolicy(autonomy=50))
    assert (d.allowed, d.requires_approval) == (allowed, approval)


def test_hibrido_autoejecuta_solo_lo_permitido_y_si_no_se_exige_aprobacion():
    pol = SessionPolicy(approval_required=False, hybrid_auto_actions=["skip"])
    assert agent_authority(Mode.HIBRIDO, "skip", False, pol).allowed
    assert not agent_authority(Mode.HIBRIDO, "set_transition", False, pol).allowed
    pol.approval_required = True
    assert not agent_authority(Mode.HIBRIDO, "skip", False, pol).allowed


def test_niveles_de_autonomia():
    assert SessionPolicy(autonomy=10).automatic_actions() == {"queue_set", "queue_clear"}
    assert "skip" in SessionPolicy(autonomy=50).automatic_actions()
    assert "eq" in SessionPolicy(autonomy=90).automatic_actions()
    assert "deck_pause" not in SessionPolicy(autonomy=100).automatic_actions()


@pytest.mark.parametrize("action,params,code", [
    ("xfader", {"value": 2.0}, "invalid_params"),
    ("rate", {"deck": 0, "value": 3.0}, "invalid_params"),
    ("eq", {"deck": 0, "low": -40}, "invalid_params"),
    ("deck_play", {"deck": 2}, "invalid_params"),
    ("xfader", {"value": 0.5, "rm": "-rf"}, "invalid_params"),   # campo extra rechazado
    ("shell", {}, "unknown_action"),
    ("set_mode_dj", {"value": "manual"}, "unknown_action"),      # solo vía endpoint de modo
])
def test_validacion_de_comandos(action, params, code):
    with pytest.raises(AppError) as exc:
        validate_command(action, params)
    assert exc.value.code == code


def test_comando_valido_normaliza_parametros():
    spec, params = validate_command("eq", {"deck": 1, "low": -12})
    assert spec.engine_action == "eq" and params == {"deck": 1, "low": -12.0, "mid": 0.0, "high": 0.0}


def test_camelot_igual_que_el_motor():
    assert camelot(0) == "8B" and camelot(21) == "8A" and camelot(-1) == "—"
    assert keys_compatible(0, 7)        # 8B y 9B
    assert keys_compatible(0, 21)       # 8B y 8A (relativa)
    assert not keys_compatible(0, 2)    # 8B y 10B


def test_tokens_de_desarrollo_y_rol_agente_no_autenticable():
    auth = StaticTokenAuthenticator("a1:ana:operator:org1;x:bot:agent:org1;malo:sin:rol")
    assert auth.authenticate("a1").role == Role.OPERATOR
    assert auth.authenticate("x") is None       # nadie se autentica como el agente
    assert auth.authenticate("") is None and len(auth) == 1


def test_redaccion_de_secretos():
    s = Settings(deepseek_api_key="sk-supersecreto123", dev_tokens="tk-zz:u:operator:o")
    assert "supersecreto" not in repr(s)
    text = ("Authorization: Bearer abc.def.ghi api_key=XYZ123 password: hunter2 "
            "sk-supersecreto123 token=tk-zz")
    out = redact(text, s.secret_values())
    for leaked in ("abc.def.ghi", "XYZ123", "hunter2", "supersecreto", "tk-zz"):
        assert leaked not in out
    rec = logging.LogRecord("x", logging.INFO, "f", 1, "clave %s", ("sk-supersecreto123",), None)
    RedactingFilter(s.secret_values()).filter(rec)
    assert "supersecreto" not in rec.getMessage()
