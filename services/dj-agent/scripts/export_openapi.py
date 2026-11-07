"""Exporta el contrato OpenAPI DERIVADO del código a docs/dj-agent/03_CONTRATOS_API_OPENAPI.yaml.

Uso (desde services/dj-agent):  python scripts/export_openapi.py
No abre la base de datos real: usa una base en memoria y el motor simulado.
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.settings import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

OUT = ROOT.parents[1] / "docs" / "dj-agent" / "03_CONTRATOS_API_OPENAPI.yaml"

HEADER = """# AUDIT SOUND · Agente DJ — Contrato OpenAPI (Fase 1)
# GENERADO desde el código con services/dj-agent/scripts/export_openapi.py — no editar a mano.
# El WebSocket de eventos (no representable en OpenAPI) está documentado en
# docs/dj-agent/05_ESTADOS_Y_POLITICAS_DEL_AGENTE.md, sección 7.
"""


def main() -> None:
    app = create_app(Settings(db_path=":memory:", scheduler_enabled=False))
    spec = app.openapi()
    OUT.write_text(HEADER + yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")
    print(f"OpenAPI exportado: {OUT} ({len(spec['paths'])} rutas)")


if __name__ == "__main__":
    main()
