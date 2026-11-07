"""Fixtures comunes. Todas las pruebas usan el MOTOR SIMULADO: nunca tocan el motor real."""

from __future__ import annotations

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.adapters.engine_fake import FakeEngine
from app.core.settings import Settings
from app.main import create_app

TOKENS = {
    "admin": "tk-admin:root:admin:org1",
    "op1": "tk-op1:ana:operator:org1",
    "op2": "tk-op2:beto:operator:org1",
    "sup": "tk-sup:sofia:supervisor:org1",
    "lis": "tk-lis:leo:listener:org1",
    "other": "tk-other:xavi:operator:org2",
}
BASE = "/api/v1/dj-agent"


class Clock:
    """Reloj controlable que parte de la hora real (coherente con las marcas de la base)."""

    def __init__(self) -> None:
        self.t = time.time()

    def __call__(self) -> float:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += seconds


def H(who: str, key: str | None = None) -> dict[str, str]:
    h = {"Authorization": f"Bearer tk-{who}"}
    if key is not None:
        h["Idempotency-Key"] = key
    return h


def K() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(db_path=str(tmp_path / "agent.db"), dev_tokens=";".join(TOKENS.values()),
                    scheduler_enabled=False, ws_auth_timeout_seconds=0.5)


@pytest.fixture
def app(settings, engine, clock):
    return create_app(settings, engine=engine, clock=clock)


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


def new_session(client: TestClient, who: str = "op1", mode: str = "HIBRIDO") -> dict:
    r = client.post(f"{BASE}/sessions", json={"name": "Sesión de prueba", "mode": mode}, headers=H(who))
    assert r.status_code == 201, r.text
    return r.json()


def set_mode(client: TestClient, sid: str, mode: str, who: str = "op1"):
    return client.post(f"{BASE}/sessions/{sid}/mode", json={"mode": mode}, headers=H(who, K()))


def command(client: TestClient, sid: str, action: str, params: dict | None = None, who: str = "op1",
            key: str | None = None):
    return client.post(f"{BASE}/sessions/{sid}/commands", json={"action": action, "params": params or {}},
                       headers=H(who, key or K()))


def intent(client: TestClient, sid: str, text: str, who: str = "op1"):
    return client.post(f"{BASE}/sessions/{sid}/intent", json={"text": text}, headers=H(who))


def prefs(client: TestClient, sid: str, body: dict, who: str = "op1"):
    return client.put(f"{BASE}/sessions/{sid}/preferences", json=body, headers=H(who))
