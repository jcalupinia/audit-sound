"""Fábrica de la aplicación FastAPI del agente DJ.

Ejecutar en local:  uvicorn --factory app.main:create_app --port 8790
(La fábrica evita abrir la base de datos al importar el módulo.)
"""

from __future__ import annotations

import asyncio
import contextlib
import time
import uuid
from collections.abc import AsyncIterator, Callable

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app import __version__
from app.adapters.engine_base import EngineAdapter
from app.adapters.engine_control_api import ControlApiAdapter
from app.adapters.engine_fake import FakeEngine
from app.api.v1.routes import router as rest_router
from app.api.v1.ws import ws_router
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.security import StaticTokenAuthenticator
from app.core.settings import Settings
from app.events.bus import EventBus
from app.orchestration.model_router import ModelRouter
from app.orchestration.session_manager import SessionManager
from app.persistence.store import Store
from app.workers.scheduler import scheduler_loop

DESCRIPTION = """Agente DJ de AUDIT SOUND (Fase 1). Servicio AISLADO del motor de audio:
planifica y emite comandos validados; el motor C++ y su AutoMix garantizan la continuidad.
Motor por defecto: SIMULADO. Contratos derivados del código implementado."""


def build_engine(settings: Settings) -> EngineAdapter:
    if settings.engine_kind == "control_api":
        return ControlApiAdapter(settings.engine_url, settings.engine_user, settings.engine_pass,
                                 timeout=settings.engine_timeout_seconds)
    return FakeEngine()


def create_app(settings: Settings | None = None, *, engine: EngineAdapter | None = None,
               router: ModelRouter | None = None, store: Store | None = None,
               clock: Callable[[], float] | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    logger = configure_logging(settings.secret_values())
    store = store or Store(settings.db_path)
    bus = EventBus(store)
    engine = engine or build_engine(settings)
    router = router or ModelRouter(settings, store)
    manager = SessionManager(settings, store, bus, engine, router, clock=clock or time.time)

    @contextlib.asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        bus.bind_loop(asyncio.get_running_loop())
        report = await asyncio.to_thread(manager.recover_on_startup)
        logger.info(f"agente iniciado · motor={engine.name} · recuperación={report}")
        task = (asyncio.create_task(scheduler_loop(manager, settings.scheduler_interval_seconds, logger))
                if settings.scheduler_enabled else None)
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="AUDIT SOUND · Agente DJ", version=__version__, description=DESCRIPTION, lifespan=lifespan)
    app.state.settings, app.state.store, app.state.bus = settings, store, bus
    app.state.engine, app.state.router, app.state.manager = engine, router, manager
    app.state.auth = StaticTokenAuthenticator(settings.dev_tokens)
    app.state.logger = logger

    @app.middleware("http")
    async def correlation(request: Request, call_next):  # type: ignore[no-untyped-def]
        cid = request.headers.get("X-Correlation-ID") or str(uuid.uuid4())
        request.state.correlation_id = cid[:100]
        t0 = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = request.state.correlation_id
        logger.info(f"{request.method} {request.url.path} → {response.status_code}",
                    extra={"correlation_id": request.state.correlation_id,
                           "duration_ms": round((time.perf_counter() - t0) * 1000, 1)})
        return response

    @app.exception_handler(AppError)
    async def app_error(request: Request, exc: AppError) -> JSONResponse:
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
        return JSONResponse(status_code=exc.status, headers=headers,
                            content={"error": {"code": exc.code, "message": exc.message, "details": exc.details,
                                               "correlation_id": getattr(request.state, "correlation_id", None)}})

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"error": {
            "code": "invalid_request", "message": "Petición inválida",
            "details": {"errors": [{"loc": list(e["loc"]), "msg": e["msg"]} for e in exc.errors()]},
            "correlation_id": getattr(request.state, "correlation_id", None)}})

    app.include_router(rest_router)
    app.include_router(ws_router)
    return app
