"""Fase 7: login unificado con el Command Center (Cuentas de Aplicaciones AUDIT-IA)."""

from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from app.adapters.engine_fake import FakeEngine
from app.core.security import ChainAuthenticator, CommandCenterAuthenticator, StaticTokenAuthenticator
from app.domain.models import Role
from app.main import create_app
from tests.conftest import BASE

ME = {
    "tok-jorge": {"email": "Jorge@Firma.ec", "apps": ["audit_sound"], "password_reset_required": False},
    "tok-op": {"email": "op@firma.ec", "apps": ["audit_sound", "otra"], "password_reset_required": False},
    "tok-sin-app": {"email": "x@firma.ec", "apps": ["otra"], "password_reset_required": False},
    "tok-reset": {"email": "y@firma.ec", "apps": ["audit_sound"], "password_reset_required": True},
}


class CC:
    def __init__(self):
        self.calls = 0
        self.down = False

    def handler(self, req: httpx.Request) -> httpx.Response:
        self.calls += 1
        if self.down:
            raise httpx.ConnectError("caído")
        assert req.url.path == "/api/v1/apps/auth/me"
        tok = req.headers.get("authorization", "")[7:]
        if tok in ME:
            return httpx.Response(200, json=ME[tok])
        return httpx.Response(401, json={"detail": "token inválido"})


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


def make(cc, clock=None, roles="jorge@firma.ec:admin;op@firma.ec:operator"):
    return CommandCenterAuthenticator("https://cc.test/api/v1/", roles=roles, transport=httpx.MockTransport(cc.handler),
                                      clock=clock or Clock())


def test_roles_por_correo_y_por_defecto_solo_lectura():
    cc = CC()
    a = make(cc, roles="jorge@firma.ec:admin")
    p = a.authenticate("tok-jorge")
    assert p.user_id == "jorge@firma.ec" and p.role == Role.ADMIN and p.org_id == "auditconsulting"
    assert a.authenticate("tok-op").role == Role.LISTENER        # no figura → solo lectura


def test_rechaza_sin_acceso_a_la_app_con_clave_pendiente_o_token_invalido():
    a = make(CC())
    assert a.authenticate("tok-sin-app") is None
    assert a.authenticate("tok-reset") is None
    assert a.authenticate("tok-falso") is None
    assert a.authenticate("") is None


def test_nadie_obtiene_el_rol_interno_del_agente():
    a = make(CC(), roles="jorge@firma.ec:agent;*:agent")
    assert a.authenticate("tok-jorge").role == Role.LISTENER


def test_cache_evita_consultar_en_cada_peticion_y_caduca():
    cc, clk = CC(), Clock()
    a = make(cc, clk)
    a.authenticate("tok-op")
    a.authenticate("tok-op")
    assert cc.calls == 1
    clk.t += 61
    a.authenticate("tok-op")
    assert cc.calls == 2


def test_command_center_caido_no_deja_entrar_ni_cachea_el_fallo():
    cc, clk = CC(), Clock()
    a = make(cc, clk)
    cc.down = True
    assert a.authenticate("tok-op") is None
    cc.down = False
    assert a.authenticate("tok-op").role == Role.OPERATOR       # se recupera en la siguiente petición


def test_cadena_llaves_de_respaldo_y_luego_command_center():
    chain = ChainAuthenticator(StaticTokenAuthenticator("tok-respaldo-1:ana:admin:auditconsulting"), make(CC()))
    assert chain.authenticate("tok-respaldo-1").user_id == "ana"
    assert chain.authenticate("tok-op").user_id == "op@firma.ec"
    assert chain.authenticate("nada") is None


def test_extremo_a_extremo_la_sesion_de_la_consola_sirve_para_el_agente(settings, monkeypatch):
    cc = CC()
    real = httpx.Client

    def client(*a, **k):
        k["transport"] = httpx.MockTransport(cc.handler)
        return real(*a, **k)

    monkeypatch.setattr(httpx, "Client", client)
    import dataclasses
    s = dataclasses.replace(settings, cc_api="https://cc.test/api/v1", cc_roles="op@firma.ec:operator")
    with TestClient(create_app(s, engine=FakeEngine())) as c:
        r = c.post(f"{BASE}/sessions", json={"name": "con login del CC", "mode": "HIBRIDO"},
                   headers={"Authorization": "Bearer tok-op"})
        assert r.status_code == 201
        assert c.get(f"{BASE}/sessions", headers={"Authorization": "Bearer tok-falso"}).status_code == 401
        # quien no figura en los roles entra como oyente: puede mirar, no operar
        assert c.get(f"{BASE}/sessions", headers={"Authorization": "Bearer tok-jorge"}).status_code == 200
        assert c.post(f"{BASE}/sessions", json={"name": "x", "mode": "HIBRIDO"},
                      headers={"Authorization": "Bearer tok-jorge"}).status_code == 403
