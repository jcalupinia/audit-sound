"""Router de modelos: respaldo determinista, circuit breaker, presupuesto y registro de consumo.

Usa proveedores SIMULADOS y httpx.MockTransport: ninguna prueba llama a un endpoint real.
"""

from __future__ import annotations

import json

import httpx
import pytest

from app.adapters.llm import LLMError, LLMResult, OpenAICompatibleProvider
from app.core.settings import Settings
from app.orchestration.intent import Intent
from app.orchestration.model_router import ModelRouter
from app.persistence.store import Store

MSG = [{"role": "user", "content": "x"}]


class FakeProvider:
    def __init__(self, name, replies, cost=0.0):
        self.name, self.model, self._replies, self.calls, self._cost = name, f"{name}-model", list(replies), 0, cost

    def configured(self):
        return True

    def estimate_cost(self, tin, tout):
        return self._cost

    def complete(self, messages, *, timeout, max_tokens):
        self.calls += 1
        r = self._replies.pop(0) if self._replies else LLMError("timeout", "sin respuesta")
        if isinstance(r, Exception):
            raise r
        return LLMResult(self.name, self.model, r, 10, 5, 12.0)


class Clk:
    def __init__(self):
        self.t = 1_000.0

    def __call__(self):
        return self.t


@pytest.fixture
def store():
    return Store(":memory:")


GOOD = json.dumps({"intent": "SKIP_TRACK", "parameters": {}, "confidence": 0.9})


def test_sin_proveedores_configurados_usa_reglas(store):
    router = ModelRouter(Settings(), store)  # sin URL ni claves → todo desactivado
    out, meta = router.complete_json("intent", MSG, Intent, org_id="o")
    assert out is None and meta.source == "rules"
    assert all(not s["configured"] for s in router.status())


def test_falla_qwen_y_responde_deepseek(store):
    qwen, ds = FakeProvider("qwen", [LLMError("timeout", "t")]), FakeProvider("deepseek", [GOOD])
    router = ModelRouter(Settings(), store, {"qwen": qwen, "deepseek": ds})
    out, meta = router.complete_json("intent", MSG, Intent, org_id="o", session_id="s")
    assert out.intent == "SKIP_TRACK" and meta.source == "deepseek" and "qwen:timeout" in meta.fallback_reasons
    assert len(store.usage_rows(org_id="o")) == 2  # se registra el fallo y el éxito


def test_salida_invalida_no_se_acepta(store):
    qwen = FakeProvider("qwen", ['{"intent":"BORRAR_TODO","confidence":1}', "no es json"])
    router = ModelRouter(Settings(), store, {"qwen": qwen})
    for _ in range(2):
        out, meta = router.complete_json("intent", MSG, Intent, org_id="o")
        assert out is None and meta.source == "rules" and "qwen:invalid_output" in meta.fallback_reasons


def test_circuit_breaker_abre_tras_fallos_y_deja_de_llamar(store):
    clk = Clk()
    qwen = FakeProvider("qwen", [LLMError("timeout", "t")] * 5)
    router = ModelRouter(Settings(llm_breaker_failures=3, llm_breaker_cooldown_seconds=60), store, {"qwen": qwen}, clock=clk)
    for _ in range(3):
        router.complete_json("intent", MSG, Intent, org_id="o")
    assert router.breakers["qwen"].state == "open"
    _, meta = router.complete_json("intent", MSG, Intent, org_id="o")
    assert qwen.calls == 3 and "qwen:circuit_open" in meta.fallback_reasons
    clk.t += 61
    router.complete_json("intent", MSG, Intent, org_id="o")
    assert qwen.calls == 4  # semiabierto: un intento tras el enfriamiento


def test_presupuesto_agotado_no_llama_al_modelo(store):
    ds = FakeProvider("deepseek", [GOOD, GOOD], cost=0.30)
    # Fase 4: el presupuesto cuenta el coste estimado de la llamada ANTES de hacerla.
    router = ModelRouter(Settings(llm_budget_usd_day=0.50, llm_budget_usd_session=10), store, {"deepseek": ds})
    out1, _ = router.complete_json("plan", MSG, Intent, org_id="o")          # 0 + 0,30 ≤ 0,50
    out2, meta = router.complete_json("plan", MSG, Intent, org_id="o")       # 0,30 + 0,30 > 0,50
    assert out1 is not None and out2 is None and "deepseek:budget_exceeded" in meta.fallback_reasons
    assert ds.calls == 1


def test_una_llamada_que_superaria_el_presupuesto_no_se_hace(store):
    ds = FakeProvider("deepseek", [GOOD], cost=0.30)
    router = ModelRouter(Settings(llm_budget_usd_day=0.25, llm_budget_usd_session=10), store, {"deepseek": ds})
    out, meta = router.complete_json("plan", MSG, Intent, org_id="o")
    assert out is None and ds.calls == 0 and meta.fallback_reasons == ["deepseek:budget_exceeded"]


def test_cuota_de_llamadas_por_hora_por_sesion_y_por_organizacion(store):
    clk = Clk()
    q = FakeProvider("qwen", [GOOD] * 10)
    router = ModelRouter(Settings(llm_max_calls_hour_session=2, llm_max_calls_hour_org=3), store, {"qwen": q}, clock=clk)
    r = [router.complete_json("intent", MSG, Intent, org_id="o", session_id="s1")[1] for _ in range(3)]
    assert [x.source for x in r] == ["qwen", "qwen", "rules"] and "qwen:rate_limited_quota" in r[2].fallback_reasons
    assert router.complete_json("intent", MSG, Intent, org_id="o", session_id="s2")[1].source == "qwen"   # 3.ª de la org
    assert router.complete_json("intent", MSG, Intent, org_id="o", session_id="s3")[1].source == "rules"  # cuota org
    assert q.calls == 3


def test_ruta_rules_no_consulta_modelos(store):
    qwen = FakeProvider("qwen", [GOOD])
    router = ModelRouter(Settings(), store, {"qwen": qwen})
    out, meta = router.complete_json("intent", MSG, Intent, org_id="o", route_pref="rules")
    assert out is None and qwen.calls == 0


def test_proveedor_openai_compatible_forma_de_peticion_y_errores():
    seen = {}

    def handler(req: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(req.url), req.headers["Authorization"], json.loads(req.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": GOOD}}],
                                         "usage": {"prompt_tokens": 20, "completion_tokens": 7}})

    p = OpenAICompatibleProvider("qwen", "http://gateway.local/v1", "clave-dev", "qwen-test",
                                 transport=httpx.MockTransport(handler))
    res = p.complete(MSG, timeout=2, max_tokens=50)
    assert seen["url"] == "http://gateway.local/v1/chat/completions" and seen["auth"] == "Bearer clave-dev"
    assert seen["body"]["response_format"] == {"type": "json_object"} and seen["body"]["temperature"] == 0
    assert res.tokens_in == 20 and res.tokens_out == 7
    for status, code in ((401, "auth"), (429, "rate_limited"), (500, "http_error")):
        bad = OpenAICompatibleProvider("q", "http://g/v1", "", "m",
                                       transport=httpx.MockTransport(lambda r, s=status: httpx.Response(s)))
        with pytest.raises(LLMError) as exc:
            bad.complete(MSG, timeout=1, max_tokens=10)
        assert exc.value.code == code
    assert not OpenAICompatibleProvider("q", "", "", "").configured()


def test_los_planes_tienen_su_propio_tiempo_limite(store):
    seen = []

    class P(FakeProvider):
        def complete(self, messages, *, timeout, max_tokens):
            seen.append(timeout)
            return super().complete(messages, timeout=timeout, max_tokens=max_tokens)

    router = ModelRouter(Settings(llm_timeout_seconds=8, llm_timeout_plan_seconds=20), store,
                         {"qwen": P("qwen", [GOOD, GOOD])})
    router.complete_json("intent", MSG, Intent, org_id="o")
    router.complete_json("plan", MSG, Intent, org_id="o")
    assert seen == [8, 20]
