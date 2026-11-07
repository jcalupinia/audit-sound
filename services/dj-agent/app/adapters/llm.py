"""Proveedor LLM compatible con OpenAI (LiteLLM local con Qwen · DeepSeek API).

Mismas convenciones que el Audi Brain Runner (backend/app/chat/providers.py):
``LOCAL_LLM_BASE_URL`` termina en ``/v1`` y se le concatena ``/chat/completions``.
Sin URL/clave configuradas el proveedor queda DESACTIVADO (no hay endpoints ficticios).
El modelo solo devuelve JSON; nunca código ni comandos.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Protocol

import httpx


class LLMError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class LLMResult:
    provider: str
    model: str
    content: str
    tokens_in: int
    tokens_out: int
    latency_ms: float


class LLMProvider(Protocol):
    name: str
    model: str

    def configured(self) -> bool: ...

    def estimate_cost(self, tokens_in: int, tokens_out: int) -> float: ...

    def complete(self, messages: list[dict[str, str]], *, timeout: float, max_tokens: int) -> LLMResult: ...


class OpenAICompatibleProvider:
    def __init__(self, name: str, base_url: str, api_key: str, model: str, *,
                 usd_per_mtok_in: float = 0.0, usd_per_mtok_out: float = 0.0,
                 transport: httpx.BaseTransport | None = None):
        self.name = name
        self.model = model
        self._base = (base_url or "").rstrip("/")
        self._key = api_key or ""
        self._price = (usd_per_mtok_in, usd_per_mtok_out)
        self._transport = transport
        self._json_mode = True   # se apaga solo si el gateway rechaza response_format (HTTP 400)

    def configured(self) -> bool:
        return bool(self._base and self.model)

    def estimate_cost(self, tokens_in: int, tokens_out: int) -> float:
        return (tokens_in * self._price[0] + tokens_out * self._price[1]) / 1_000_000

    def complete(self, messages: list[dict[str, str]], *, timeout: float, max_tokens: int) -> LLMResult:
        if not self.configured():
            raise LLMError("not_configured", f"Proveedor {self.name} sin configurar")
        headers = {"Authorization": f"Bearer {self._key or 'no-key'}", "Content-Type": "application/json"}
        body: dict[str, Any] = {"model": self.model, "messages": messages, "temperature": 0, "max_tokens": max_tokens}
        if self._json_mode:
            body["response_format"] = {"type": "json_object"}
        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=timeout, transport=self._transport) as client:
                r = client.post(f"{self._base}/chat/completions", json=body, headers=headers)
                if r.status_code == 400 and "response_format" in body:
                    # Algunos backends detrás de LiteLLM no admiten el modo JSON: se reintenta una vez
                    # sin él; la salida igual se extrae y valida del lado del agente.
                    self._json_mode = False
                    body.pop("response_format")
                    r = client.post(f"{self._base}/chat/completions", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            raise LLMError("timeout", f"{self.name}: tiempo agotado") from exc
        except httpx.TransportError as exc:
            raise LLMError("unreachable", f"{self.name}: sin conexión") from exc
        latency = (time.perf_counter() - t0) * 1000
        if r.status_code in (401, 403):
            raise LLMError("auth", f"{self.name}: credencial rechazada")
        if r.status_code == 402:
            raise LLMError("insufficient_balance", f"{self.name}: saldo o tope de gasto agotado")
        if r.status_code == 429:
            raise LLMError("rate_limited", f"{self.name}: cuota o límite alcanzado")
        if r.status_code != 200:
            raise LLMError("http_error", f"{self.name}: HTTP {r.status_code}")
        try:
            j = r.json()
            content = j["choices"][0]["message"]["content"]
            usage = j.get("usage") or {}
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMError("invalid_response", f"{self.name}: respuesta con formato inesperado") from exc
        return LLMResult(provider=self.name, model=self.model, content=str(content),
                         tokens_in=int(usage.get("prompt_tokens", 0)), tokens_out=int(usage.get("completion_tokens", 0)),
                         latency_ms=latency)
