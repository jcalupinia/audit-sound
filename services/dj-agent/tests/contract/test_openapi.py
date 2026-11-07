"""El contrato OpenAPI se DERIVA del código y contiene todas las operaciones de la Fase 1."""

from __future__ import annotations

REQUIRED = {
    ("post", "/api/v1/dj-agent/sessions"), ("get", "/api/v1/dj-agent/sessions"),
    ("get", "/api/v1/dj-agent/sessions/{sid}"), ("post", "/api/v1/dj-agent/sessions/{sid}/close"),
    ("post", "/api/v1/dj-agent/sessions/{sid}/mode"), ("post", "/api/v1/dj-agent/sessions/{sid}/control"),
    ("post", "/api/v1/dj-agent/sessions/{sid}/commands"), ("get", "/api/v1/dj-agent/sessions/{sid}/commands"),
    ("post", "/api/v1/dj-agent/sessions/{sid}/intent"), ("post", "/api/v1/dj-agent/sessions/{sid}/plans"),
    ("get", "/api/v1/dj-agent/sessions/{sid}/plans/current"), ("get", "/api/v1/dj-agent/sessions/{sid}/proposals"),
    ("post", "/api/v1/dj-agent/sessions/{sid}/proposals/{pid}/decision"),
    ("get", "/api/v1/dj-agent/sessions/{sid}/preferences"), ("put", "/api/v1/dj-agent/sessions/{sid}/preferences"),
    ("get", "/api/v1/dj-agent/sessions/{sid}/events"), ("get", "/api/v1/dj-agent/models/status"),
    ("get", "/api/v1/dj-agent/usage"), ("get", "/api/v1/dj-agent/health"), ("get", "/api/v1/dj-agent/catalog/tracks"),
}


def test_rutas_documentadas(client):
    spec = client.get("/openapi.json").json()
    present = {(m, p) for p, ops in spec["paths"].items() for m in ops}
    assert REQUIRED <= present, REQUIRED - present
    params = {p["name"] for p in spec["paths"]["/api/v1/dj-agent/sessions/{sid}/commands"]["post"]["parameters"]}
    assert "Idempotency-Key" in params
    modes = spec["components"]["schemas"]["Mode"]["enum"]
    assert modes == ["MANUAL", "HIBRIDO", "AUTOMATICO"]
