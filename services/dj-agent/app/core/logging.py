"""Logs estructurados (JSON) con redacción de secretos.

Toda línea pasa por ``RedactingFilter``: oculta tokens Bearer, claves tipo ``sk-``,
pares ``api_key=...``/``password=...`` y los valores secretos de la configuración.
"""

from __future__ import annotations

import json
import logging
import re
import time

_PATTERNS = [
    (re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+", re.I), r"\1[REDACTADO]"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{6,}"), "[REDACTADO]"),
    (re.compile(r"((?:api[_-]?key|password|pass|token|secret)[\"']?\s*[:=]\s*[\"']?)[^\s\"',&}]+", re.I),
     r"\1[REDACTADO]"),
]


def redact(text: str, secrets: list[str] | None = None) -> str:
    out = text
    for value in secrets or []:
        out = out.replace(value, "[REDACTADO]")
    for pattern, repl in _PATTERNS:
        out = pattern.sub(repl, out)
    return out


class RedactingFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self.secrets = secrets

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(record.getMessage(), self.secrets)
        record.args = ()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("session_id", "actor_id", "request_id", "correlation_id", "source", "duration_ms"):
            val = getattr(record, key, None)
            if val is not None:
                data[key] = val
        return json.dumps(data, ensure_ascii=False)


def configure_logging(secrets: list[str]) -> logging.Logger:
    logger = logging.getLogger("dj_agent")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactingFilter(secrets))
    logger.addHandler(handler)
    logger.propagate = False
    return logger
