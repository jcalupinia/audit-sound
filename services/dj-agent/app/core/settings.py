"""Configuración por variables de entorno.

Los secretos se marcan con ``repr=False`` para que nunca aparezcan al imprimir la
configuración ni en trazas. Sin configuración de IA, el agente funciona solo con
reglas deterministas (no hay dependencia obligatoria de servicios externos).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _float(name: str, default: float) -> float:
    try:
        return float(_env(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(_env(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    db_path: str = "dj_agent.db"
    engine_kind: str = "fake"  # "fake" (simulador) | "control_api" (motor C++ real)
    engine_url: str = ""
    engine_user: str = ""
    engine_pass: str = field(default="", repr=False)
    engine_timeout_seconds: float = 3.0
    # Autenticación de desarrollo: "token:usuario:rol:org;token2:..."
    dev_tokens: str = field(default="", repr=False)
    lease_seconds: int = 120
    scheduler_enabled: bool = True
    scheduler_interval_seconds: float = 5.0
    ws_replay_limit: int = 500
    ws_auth_timeout_seconds: float = 5.0
    # IA (opcional; mismas convenciones que el Audi Brain Runner)
    local_llm_base_url: str = ""
    local_llm_api_key: str = field(default="", repr=False)
    local_llm_model: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_api_key: str = field(default="", repr=False)
    deepseek_model: str = "deepseek-flash"
    llm_timeout_seconds: float = 8.0
    llm_timeout_plan_seconds: float = 20.0   # planes: no son en tiempo real (la música sigue mientras tanto)
    llm_no_think: bool = True        # Qwen3: «/no_think» desactiva el razonamiento largo (latencia)
    llm_budget_usd_day: float = 1.0
    llm_budget_usd_session: float = 0.25
    llm_max_calls_hour_org: int = 120      # cuota de llamadas a modelos por organización y hora
    llm_max_calls_hour_session: int = 30   # … y por sesión y hora
    llm_max_tokens_intent: int = 200
    llm_max_tokens_plan: int = 500
    # Tarifas por millón de tokens: ESTIMACIÓN configurable (confirmar en la cuenta DeepSeek).
    deepseek_usd_per_mtok_in: float = 0.27
    deepseek_usd_per_mtok_out: float = 1.10
    llm_breaker_failures: int = 3
    llm_breaker_cooldown_seconds: float = 60.0

    @staticmethod
    def from_env() -> Settings:
        return Settings(
            db_path=_env("DJ_AGENT_DB_PATH", "dj_agent.db"),
            engine_kind=_env("DJ_AGENT_ENGINE", "fake").lower() or "fake",
            engine_url=_env("DJ_AGENT_ENGINE_URL"),
            engine_user=_env("DJ_AGENT_ENGINE_USER"),
            engine_pass=_env("DJ_AGENT_ENGINE_PASS"),
            engine_timeout_seconds=_float("DJ_AGENT_ENGINE_TIMEOUT_SECONDS", 3.0),
            dev_tokens=_env("DJ_AGENT_DEV_TOKENS"),
            lease_seconds=_int("DJ_AGENT_LEASE_SECONDS", 120),
            scheduler_enabled=_env("DJ_AGENT_SCHEDULER_ENABLED", "true").lower() not in ("0", "false", "no"),
            scheduler_interval_seconds=_float("DJ_AGENT_SCHEDULER_INTERVAL_SECONDS", 5.0),
            ws_replay_limit=_int("DJ_AGENT_WS_REPLAY_LIMIT", 500),
            local_llm_base_url=_env("LOCAL_LLM_BASE_URL"),
            local_llm_api_key=_env("LOCAL_LLM_API_KEY"),
            local_llm_model=_env("LOCAL_LLM_MODEL"),
            deepseek_base_url=_env("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1"),
            deepseek_api_key=_env("DEEPSEEK_API_KEY"),
            deepseek_model=_env("DEEPSEEK_MODEL", "deepseek-flash"),
            llm_timeout_seconds=_float("DJ_AGENT_LLM_TIMEOUT_SECONDS", 8.0),
            llm_timeout_plan_seconds=_float("DJ_AGENT_LLM_TIMEOUT_PLAN_SECONDS", 20.0),
            llm_no_think=_env("DJ_AGENT_LLM_NO_THINK", "true").lower() not in ("0", "false", "no"),
            llm_budget_usd_day=_float("DJ_AGENT_LLM_BUDGET_USD_DAY", 1.0),
            llm_budget_usd_session=_float("DJ_AGENT_LLM_BUDGET_USD_SESSION", 0.25),
            llm_max_calls_hour_org=_int("DJ_AGENT_LLM_MAX_CALLS_HOUR_ORG", 120),
            llm_max_calls_hour_session=_int("DJ_AGENT_LLM_MAX_CALLS_HOUR_SESSION", 30),
            llm_max_tokens_intent=_int("DJ_AGENT_LLM_MAX_TOKENS_INTENT", 200),
            llm_max_tokens_plan=_int("DJ_AGENT_LLM_MAX_TOKENS_PLAN", 500),
            deepseek_usd_per_mtok_in=_float("DJ_AGENT_DEEPSEEK_USD_PER_MTOK_IN", 0.27),
            deepseek_usd_per_mtok_out=_float("DJ_AGENT_DEEPSEEK_USD_PER_MTOK_OUT", 1.10),
        )

    def secret_values(self) -> list[str]:
        """Valores que el redactor de logs debe ocultar siempre."""
        vals = [self.engine_pass, self.local_llm_api_key, self.deepseek_api_key]
        for item in self.dev_tokens.split(";"):
            tok = item.split(":", 1)[0].strip()
            if tok:
                vals.append(tok)
        return [v for v in vals if v and len(v) >= 4]
