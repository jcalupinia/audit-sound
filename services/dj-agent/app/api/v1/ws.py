"""WebSocket de estado en tiempo real.

Protocolo:
 1. El cliente abre ``/api/v1/dj-agent/sessions/{id}/events`` y envía en ≤5 s
    ``{"type":"auth","token":"…","after":N}`` (el token NO va en la URL).
 2. El servidor responde ``session.snapshot`` (estado autoritativo + ``sequence``).
 3. Si ``after`` < sequence, reenvía los eventos perdidos (replay acotado).
 4. Después, eventos en vivo, sin duplicados (se descarta todo ``sequence`` ya enviado).
 ``{"type":"ping"}`` → ``{"type":"pong"}``. Cierres: 4401 sin autenticar, 4403 sin permiso,
 4404 sesión inexistente/de otra organización.
"""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.domain.policies import has_permission

ws_router = APIRouter()


@ws_router.websocket("/api/v1/dj-agent/sessions/{sid}/events")
async def session_events(ws: WebSocket, sid: str) -> None:
    app = ws.app
    settings, manager, bus = app.state.settings, app.state.manager, app.state.bus
    await ws.accept()
    try:
        msg = await asyncio.wait_for(ws.receive_json(), timeout=settings.ws_auth_timeout_seconds)
    except (TimeoutError, WebSocketDisconnect, ValueError, json.JSONDecodeError):
        await _close(ws, 4401)
        return
    # En hilo aparte: el login del Command Center hace una petición HTTP y no debe bloquear el bucle.
    principal = (await asyncio.to_thread(app.state.auth.authenticate, str(msg.get("token", "")))
                 if msg.get("type") == "auth" else None)
    if principal is None:
        await _close(ws, 4401)
        return
    if not has_permission(principal.role, "events:subscribe"):
        await _close(ws, 4403)
        return
    row = manager.store.get_session(sid)
    if row is None or row["org_id"] != principal.org_id:
        await _close(ws, 4404)
        return

    queue = bus.subscribe(sid)  # antes del snapshot: no se pierde nada en medio
    try:
        snap = await asyncio.to_thread(manager.get, sid, principal)
        seq = snap.last_sequence
        await ws.send_json({"type": "session.snapshot", "session_id": sid, "sequence": seq, "timestamp": time.time(),
                            "source": "agent", "payload": snap.model_dump(mode="json")})
        after = msg.get("after")
        last_sent = seq
        if isinstance(after, int) and 0 <= after < seq:
            replay = manager.store.events_since(sid, after, settings.ws_replay_limit)
            for ev in replay:
                if ev["sequence"] > seq:
                    break
                await ws.send_json(ev)
            if replay and replay[-1]["sequence"] < seq:
                await ws.send_json({"type": "replay_truncated", "session_id": sid, "sequence": seq})
        recv = asyncio.create_task(ws.receive_text())
        while True:
            getter = asyncio.create_task(queue.get())
            done, _ = await asyncio.wait({recv, getter}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                ev = getter.result()
                if ev.get("type") == "resync_required" or ev.get("sequence", 0) > last_sent:
                    await ws.send_json(ev)
                    last_sent = max(last_sent, ev.get("sequence", 0))
            else:
                getter.cancel()
            if recv in done:
                try:
                    text = recv.result()
                except WebSocketDisconnect:
                    break
                try:
                    if json.loads(text).get("type") == "ping":
                        await ws.send_json({"type": "pong", "sequence": last_sent})
                except (ValueError, AttributeError):
                    pass
                recv = asyncio.create_task(ws.receive_text())
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(sid, queue)


async def _close(ws: WebSocket, code: int) -> None:
    try:
        await ws.close(code=code)
    except RuntimeError:
        pass
