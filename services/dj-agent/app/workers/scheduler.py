"""Ciclo periódico del agente (reconciliación, caducidad de propuestas, cola en AUTOMÁTICO).

Corre fuera del hilo del bucle (``to_thread``) y NUNCA propaga excepciones: un fallo del
agente no afecta al motor, que sigue sonando con su AutoMix.
"""

from __future__ import annotations

import asyncio
import logging

from app.orchestration.session_manager import SessionManager


async def scheduler_loop(manager: SessionManager, interval: float, logger: logging.Logger) -> None:
    while True:
        await asyncio.sleep(interval)
        for sid in manager.active_session_ids():
            try:
                await asyncio.to_thread(manager.tick, sid)
            except Exception:  # noqa: BLE001 - el ciclo jamás debe caerse
                logger.exception("tick del agente falló (el motor no se ve afectado)", extra={"session_id": sid})
