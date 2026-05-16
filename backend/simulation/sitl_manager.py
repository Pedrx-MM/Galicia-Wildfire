"""
Galicia Wildfire — SITLManager (stub).

Con la arquitectura Docker/mavlink-bridge el ArduPilot real ya no es necesario.
El dron simulado corre en el contenedor simulador-gw y el mavlink-bridge
genera los paquetes MAVLink UDP.

Este módulo se conserva únicamente porque main.py lo instancia; en modo
'external' (por defecto) todos los métodos son no-ops.
"""
import logging

log = logging.getLogger("gw.sitl")


class SITLManager:

    def __init__(self, mode: str = "external"):
        self.mode = mode
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    async def start(self, lat: float = 0, lon: float = 0,
                    alt_m: float = 0, heading: float = 0) -> bool:
        log.debug("[SITL] modo=%s — no-op (simulador-gw Docker)", self.mode)
        return True

    async def stop(self) -> None:
        log.debug("[SITL] stop — no-op")

    async def restart_at(self, lat: float = 0, lon: float = 0,
                         alt_m: float = 0) -> bool:
        return True

    async def poll_running(self) -> bool:
        return True
