"""Router de modelos con circuit breaker, presupuesto, registro de consumo y respaldo determinista.

Orden por tarea (configurable por la preferencia ``model_route`` de la sesión):
  intent → qwen, deepseek     (clasificación breve: primero el modelo local)
  plan   → deepseek, qwen     (planes multi-etapa: primero el razonamiento externo)
  "rules" → ningún modelo (solo reglas deterministas)
Si ningún proveedor está configurado, disponible, dentro de presupuesto y devuelve JSON
válido según el esquema, el router devuelve ``None`` y el llamador usa reglas: el agente
nunca depende de la IA para operar, y el audio nunca depende del agente.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.adapters.llm import LLMError, LLMProvider, OpenAICompatibleProvider
from app.core.settings import Settings
from app.orchestration.llm_intent import extract_json
from app.persistence.store import Store

T = TypeVar("T", bound=BaseModel)

TASK_ORDER = {"intent": ["qwen", "deepseek"], "plan": ["deepseek", "qwen"]}


@dataclass
class CircuitBreaker:
    threshold: int = 3
    cooldown: float = 60.0
    failures: int = 0
    opened_at: float | None = None
    clock: Any = field(default=time.time)

    def allow(self) -> bool:
        if self.opened_at is None:
            return True
        if self.clock() - self.opened_at >= self.cooldown:
            return True  # semiabierto: deja pasar un intento
        return False

    @property
    def state(self) -> str:
        if self.opened_at is None:
            return "closed"
        return "half_open" if self.allow() else "open"

    def success(self) -> None:
        self.failures, self.opened_at = 0, None

    def failure(self) -> None:
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = self.clock()


@dataclass
class RouterOutcome:
    source: str                      # "qwen" | "deepseek" | "rules"
    fallback_reasons: list[str]


class ModelRouter:
    def __init__(self, settings: Settings, store: Store, providers: dict[str, LLMProvider] | None = None,
                 clock: Any = time.time):
        self.settings = settings
        self.store = store
        self.clock = clock
        if providers is None:
            providers = {
                "qwen": OpenAICompatibleProvider("qwen", settings.local_llm_base_url, settings.local_llm_api_key,
                                                 settings.local_llm_model),
                # Precio = ESTIMACIÓN rotulada; confirmar en la cuenta DeepSeek (no verificado).
                "deepseek": OpenAICompatibleProvider("deepseek", settings.deepseek_base_url if settings.deepseek_api_key else "",
                                                     settings.deepseek_api_key, settings.deepseek_model,
                                                     usd_per_mtok_in=0.27, usd_per_mtok_out=1.10),
            }
        self.providers = providers
        self.breakers = {n: CircuitBreaker(settings.llm_breaker_failures, settings.llm_breaker_cooldown_seconds, clock=clock)
                         for n in providers}
        self.last: dict[str, dict[str, Any]] = {n: {} for n in providers}

    def status(self) -> list[dict[str, Any]]:
        out = []
        for name, p in self.providers.items():
            out.append({"name": name, "configured": p.configured(), "model": p.model if p.configured() else None,
                        "breaker": self.breakers[name].state, "last_outcome": self.last[name].get("outcome"),
                        "last_latency_ms": self.last[name].get("latency_ms")})
        return out

    def _order(self, task: str, route_pref: str) -> list[str]:
        if route_pref == "rules":
            return []
        if route_pref in self.providers:
            return [route_pref]
        return [n for n in TASK_ORDER.get(task, []) if n in self.providers]

    def _within_budget(self, org_id: str, session_id: str | None) -> bool:
        day_ago = self.clock() - 86400
        if self.store.usage_cost(org_id=org_id, since=day_ago) >= self.settings.llm_budget_usd_day:
            return False
        if session_id and self.store.usage_cost(session_id=session_id) >= self.settings.llm_budget_usd_session:
            return False
        return True

    def complete_json(self, task: str, messages: list[dict[str, str]], schema: type[T], *, org_id: str,
                      session_id: str | None = None, route_pref: str = "auto",
                      max_tokens: int = 400) -> tuple[T | None, RouterOutcome]:
        reasons: list[str] = []
        for name in self._order(task, route_pref):
            provider = self.providers[name]
            if not provider.configured():
                reasons.append(f"{name}:not_configured")
                continue
            if not self.breakers[name].allow():
                reasons.append(f"{name}:circuit_open")
                continue
            if not self._within_budget(org_id, session_id):
                reasons.append(f"{name}:budget_exceeded")
                continue
            try:
                res = provider.complete(messages, timeout=self.settings.llm_timeout_seconds, max_tokens=max_tokens)
            except LLMError as exc:
                self.breakers[name].failure()
                self.last[name] = {"outcome": exc.code}
                self.store.insert_usage({"session_id": session_id, "org_id": org_id, "provider": name,
                                         "model": provider.model, "outcome": exc.code})
                reasons.append(f"{name}:{exc.code}")
                continue
            cost = provider.estimate_cost(res.tokens_in, res.tokens_out)
            try:
                parsed = schema.model_validate(json.loads(extract_json(res.content)))
                outcome = "ok"
            except (ValueError, ValidationError):
                parsed, outcome = None, "invalid_output"
            self.store.insert_usage({"session_id": session_id, "org_id": org_id, "provider": name,
                                     "model": res.model, "tokens_in": res.tokens_in, "tokens_out": res.tokens_out,
                                     "cost_estimated": cost, "latency_ms": res.latency_ms, "outcome": outcome})
            self.last[name] = {"outcome": outcome, "latency_ms": round(res.latency_ms, 1)}
            if parsed is None:
                self.breakers[name].failure()
                reasons.append(f"{name}:invalid_output")
                continue
            self.breakers[name].success()
            return parsed, RouterOutcome(source=name, fallback_reasons=reasons)
        if not reasons:
            reasons.append("no_providers_for_route")
        return None, RouterOutcome(source="rules", fallback_reasons=reasons)
