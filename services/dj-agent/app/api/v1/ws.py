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


VOICE_MAX_FRAME = 64 * 1024          # bytes por mensaje (~0,7 s a 48 kHz)
VOICE_MAX_BACKLOG_SEC = 1.0          # si el motor va más lento, se descarta voz vieja (no crece el retraso)


@ws_router.websocket("/api/v1/dj-agent/sessions/{sid}/voice")
async def session_voice(ws: WebSocket, sid: str) -> None:
    """Micrófonos del DJ al stream.

    1. ``{"type":"auth","token":"…","sample_rate":48000}`` en ≤5 s (rol operador o administrador).
    2. Mensajes binarios: PCM 16 bits mono little-endian a ``sample_rate``. El agente los reenvía al
       motor en orden; el motor los mezcla con la música antes de Icecast.
    3. Texto: ``{"type":"talkover","mode":0|1|2,"gain":1.0,"duck":-14}`` y ``{"type":"ping"}``.
    El servidor responde ``voice.ready`` y, cada ~1 s, ``voice.stats`` (segundos enviados, retraso del
    motor). Cierres: 4401 sin autenticar, 4403 sin permiso, 4404 sesión ajena, 4409 motor sin voz.
    """
    app = ws.app
    settings, manager = app.state.settings, app.state.manager
    await ws.accept()
    try:
        msg = await asyncio.wait_for(ws.receive_json(), timeout=settings.ws_auth_timeout_seconds)
    except (TimeoutError, WebSocketDisconnect, ValueError, json.JSONDecodeError):
        await _close(ws, 4401)
        return
    principal = (await asyncio.to_thread(app.state.auth.authenticate, str(msg.get("token", "")))
                 if msg.get("type") == "auth" else None)
    if principal is None:
        await _close(ws, 4401)
        return
    if not has_permission(principal.role, "voice:broadcast"):
        await _close(ws, 4403)
        return
    row = manager.store.get_session(sid)
    if row is None or row["org_id"] != principal.org_id:
        await _close(ws, 4404)
        return
    engine = manager.engine
    if not hasattr(engine, "voice_push"):
        await _close(ws, 4409)
        return
    try:
        sr = int(msg.get("sample_rate") or 48000)
    except (TypeError, ValueError):
        sr = 48000
    if not 8000 <= sr <= 96000:
        await _close(ws, 4400)
        return

    pending: asyncio.Queue[bytes | None] = asyncio.Queue()
    stats = {"sent_s": 0.0, "dropped_s": 0.0, "buffered_ms": 0, "error": None}
    bytes_per_s = sr * 2

    async def forward() -> None:
        while True:
            chunk = await pending.get()
            if chunk is None:
                return
            # Si se acumuló más de 1 s (motor lento o red a ráfagas), se descarta lo viejo.
            backlog = chunk
            while not pending.empty() and len(backlog) < VOICE_MAX_BACKLOG_SEC * bytes_per_s:
                nxt = pending.get_nowait()
                if nxt is None:
                    pending.put_nowait(None)
                    break
                backlog += nxt
            if len(backlog) > VOICE_MAX_BACKLOG_SEC * bytes_per_s:
                cut = (len(backlog) - int(0.25 * bytes_per_s)) & ~1
                stats["dropped_s"] += cut / bytes_per_s
                backlog = backlog[cut:]
            try:
                r = await asyncio.to_thread(engine.voice_push, backlog, sr)
                stats["sent_s"] += len(backlog) / bytes_per_s
                stats["buffered_ms"] = int(r.get("buffered_ms", 0))
                stats["error"] = None
            except Exception as exc:  # motor caído o sin control: la música sigue, se avisa al DJ
                stats["error"] = getattr(exc, "code", "engine_error")

    worker = asyncio.create_task(forward())
    manager._publish(sid, "voice.started", {"sample_rate": sr}, actor=principal.user_id, source="user")
    await ws.send_json({"type": "voice.ready", "sample_rate": sr})
    last_stats = time.monotonic()
    try:
        while True:
            m = await ws.receive()
            if m.get("type") == "websocket.disconnect":
                break
            data = m.get("bytes")
            if data is not None:
                if len(data) > VOICE_MAX_FRAME or len(data) % 2:
                    await ws.send_json({"type": "voice.error", "code": "bad_frame"})
                    continue
                pending.put_nowait(data)
            else:
                try:
                    obj = json.loads(m.get("text") or "{}")
                except ValueError:
                    obj = {}
                if obj.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
                elif obj.get("type") == "talkover":
                    try:
                        mode = int(obj.get("mode", 2))
                        gain = obj.get("gain")
                        duck = obj.get("duck")
                        await asyncio.to_thread(engine.talkover, mode if mode in (0, 1, 2) else 2,
                                                None if gain is None else max(0.0, min(4.0, float(gain))),
                                                None if duck is None else max(-60.0, min(0.0, float(duck))))
                        await ws.send_json({"type": "talkover.ok", "mode": mode})
                    except Exception as exc:
                        await ws.send_json({"type": "voice.error", "code": getattr(exc, "code", "engine_error")})
            now = time.monotonic()
            if now - last_stats >= 1.0:
                last_stats = now
                await ws.send_json({"type": "voice.stats", "sent_s": round(stats["sent_s"], 2),
                                    "dropped_s": round(stats["dropped_s"], 2),
                                    "engine_buffer_ms": stats["buffered_ms"], "error": stats["error"]})
    except WebSocketDisconnect:
        pass
    finally:
        pending.put_nowait(None)
        try:
            await asyncio.wait_for(worker, timeout=3)
        except Exception:
            worker.cancel()
        manager._publish(sid, "voice.stopped", {"seconds": round(stats["sent_s"], 1)},
                         actor=principal.user_id, source="user")


async def _close(ws: WebSocket, code: int) -> None:
    try:
        await ws.close(code=code)
    except RuntimeError:
        pass
