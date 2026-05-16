"""
Galicia Wildfire — WebSocket /ws/telemetry
Broadcaster de telemetría: cola privada por cliente, no broadcast global.
Un task central consume MAVLinkManager.telemetry_queue y redistribuye.
"""
import asyncio
import json
import logging
from typing import Optional

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger("gw.ws.telemetry")


class ConnectionManager:
    """Gestiona clientes WS de telemetría con colas privadas."""

    def __init__(self):
        # client_id → (WebSocket, asyncio.Queue)
        self._clients: dict[str, tuple[WebSocket, asyncio.Queue]] = {}
        self._lock = asyncio.Lock()
        self._broadcaster_task: Optional[asyncio.Task] = None

    async def connect(self, ws: WebSocket, client_id: str) -> asyncio.Queue:
        await ws.accept()
        q: asyncio.Queue = asyncio.Queue(maxsize=2)
        async with self._lock:
            self._clients[client_id] = (ws, q)
        log.info("[WS/tel] Cliente conectado: %s (total=%d)", client_id, len(self._clients))
        return q

    async def disconnect(self, client_id: str) -> None:
        async with self._lock:
            self._clients.pop(client_id, None)
        log.info("[WS/tel] Cliente desconectado: %s (total=%d)", client_id, len(self._clients))

    async def _broadcast_one(self, payload: str) -> None:
        """Distribuye el mismo payload JSON a todos los clientes conectados."""
        dead = []
        async with self._lock:
            snapshot = list(self._clients.items())
        for cid, (ws, q) in snapshot:
            try:
                # Descarta si el cliente va lento
                if q.full():
                    try:
                        q.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                q.put_nowait(payload)
            except Exception:
                dead.append(cid)
        for cid in dead:
            await self.disconnect(cid)

    def start_broadcaster(self, mav) -> asyncio.Task:
        """
        Arranca el task central que consume mav.telemetry_queue y
        redistribuye a clientes WebSocket.
        Llamar desde el lifespan de FastAPI.
        """
        self._broadcaster_task = asyncio.create_task(
            self._telemetry_broadcaster(mav),
            name="ws-telemetry-broadcaster",
        )
        return self._broadcaster_task

    async def _telemetry_broadcaster(self, mav) -> None:
        """Consume MAVLinkManager.telemetry_queue y envía a todos los clientes."""
        log.info("[WS/tel] Broadcaster iniciado")
        while True:
            try:
                snapshot: dict = await mav.telemetry_queue.get()
                payload = json.dumps({"type": "telemetry", "data": snapshot})
                await self._broadcast_one(payload)
            except asyncio.CancelledError:
                log.info("[WS/tel] Broadcaster cancelado")
                break
            except Exception as exc:
                log.error("[WS/tel] Error en broadcaster: %s", exc)
                await asyncio.sleep(0.5)


# Instancia global — compartida por el endpoint y el lifespan
telemetry_manager = ConnectionManager()


async def telemetry_ws_endpoint(ws: WebSocket, mav):
    """
    Endpoint WebSocket /ws/telemetry.
    Recibe el ws de FastAPI y el MAVLinkManager del app.state.
    """
    import uuid
    client_id = str(uuid.uuid4())[:8]
    q = await telemetry_manager.connect(ws, client_id)

    try:
        while True:
            payload: str = await q.get()
            await ws.send_text(payload)
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("[WS/tel] Error con cliente %s: %s", client_id, exc)
    finally:
        await telemetry_manager.disconnect(client_id)
