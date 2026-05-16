"""
Galicia Wildfire — MAVLink connection manager para ArduCopter SITL (Docker TCP:5760).
Loop async auto-reconectante. Solicita streams de datos al conectar.
"""
import asyncio
import logging
import time
from typing import Optional

from mavlink.telemetry import TelemetryData, parse_mavlink_message

log = logging.getLogger("gw.mavlink")

POLL_HZ    = 100   # recv_match(blocking=False) poll rate
PUBLISH_HZ = 20    # tasa de publicación de telemetría al broadcaster


class MAVLinkManager:

    def __init__(self, host: str = "127.0.0.1", port: int = 5760):
        self.host = host
        self.port = port
        self._conn          = None
        self._connected     = False
        self._running       = False
        self._use_mock      = True   # mock activo hasta conectar
        self._mock_home: tuple[float, float] = (42.60, -7.05)

        self.telemetry       = TelemetryData()
        self.telemetry_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        self._send_lock: Optional[asyncio.Lock] = None
        self.recv_paused     = False
        self._read_task: Optional[asyncio.Task] = None
        self._mock_task: Optional[asyncio.Task] = None
        self._last_publish   = 0.0

    # ─── Propiedades ──────────────────────────────────────────────────────────

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def use_mock(self) -> bool:
        return self._use_mock

    def _connection_str(self) -> str:
        return f"udpin:0.0.0.0:{self.port}"

    # ─── Loop principal (lanzar como task en lifespan) ────────────────────────

    async def start_loop(self) -> None:
        """
        Loop permanente: conecta al SITL, se reconecta automáticamente si cae.
        Mientras no hay SITL, corre mock. Lanzar con asyncio.create_task().
        """
        self._send_lock = asyncio.Lock()
        self._running   = True

        # Mock inmediato para que el broadcaster tenga datos mientras conecta
        self._use_mock  = True
        self._mock_task = asyncio.create_task(self._mock_loop(), name="mavlink-mock")

        while self._running:
            ok = await self._try_connect()
            if ok:
                # Esperar hasta que el read_loop termine (desconexión o error)
                if self._read_task and not self._read_task.done():
                    try:
                        await self._read_task
                    except asyncio.CancelledError:
                        break
                    except Exception:
                        pass
                # Reconectar: volver a modo mock mientras reintenta
                if self._running:
                    self._connected = False
                    self._use_mock  = True
                    if not self._mock_task or self._mock_task.done():
                        self._mock_task = asyncio.create_task(
                            self._mock_loop(), name="mavlink-mock"
                        )
            if self._running:
                log.info("[MAVLink] Reintentando conexión en 5s...")
                await asyncio.sleep(5)

    async def connect(self) -> bool:
        """Intento único sin retry (compatibilidad con código legado)."""
        if not self._send_lock:
            self._send_lock = asyncio.Lock()
        self._use_mock = True
        if not self._mock_task or self._mock_task.done():
            self._mock_task = asyncio.create_task(self._mock_loop(), name="mavlink-mock")
        return await self._try_connect()

    async def reconnect_to_sitl(self) -> bool:
        """Con UDP (udpin), start_loop() ya gestiona la reconexión automáticamente.
        Aquí solo esperamos hasta 20s a que el heartbeat llegue del SITL recién arrancado."""
        if self._connected and not self._use_mock:
            log.info("[MAVLink] Ya conectado")
            return True
        log.info("[MAVLink] Esperando heartbeat del SITL (UDP:14550)...")
        for _ in range(40):
            await asyncio.sleep(0.5)
            if self._connected and not self._use_mock:
                log.info("[MAVLink] SITL conectado")
                return True
        log.warning("[MAVLink] SITL no respondió en 20s — backend sigue en mock")
        return False

    # ─── Conexión ─────────────────────────────────────────────────────────────

    async def _try_connect(self) -> bool:
        import pymavlink.mavutil as mavutil
        loop = asyncio.get_running_loop()
        conn = None
        try:
            log.info("[MAVLink] Escuchando en %s...", self._connection_str())
            conn = await loop.run_in_executor(
                None,
                lambda: mavutil.mavlink_connection(
                    self._connection_str(),
                    source_system=255,
                    dialect="ardupilotmega",
                )
            )
            hb = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: conn.wait_heartbeat(timeout=10)),
                timeout=12,
            )
            if hb is None:
                raise ConnectionError("Sin heartbeat")

            self._conn      = conn
            self._connected = True
            self._use_mock  = False
            log.info("[MAVLink] Conectado — sysid=%d", conn.target_system)

            # Cancelar mock
            if self._mock_task and not self._mock_task.done():
                self._mock_task.cancel()
                try:
                    await self._mock_task
                except asyncio.CancelledError:
                    pass
                self._mock_task = None

            await self._request_streams()
            self._read_task = asyncio.create_task(self._read_loop(), name="mavlink-read")
            return True

        except Exception as exc:
            if conn:
                try:
                    conn.close()
                except Exception:
                    pass
            log.warning("[MAVLink] Sin conexión (%s)", exc)
            self._connected = False
            self._use_mock  = True
            return False

    # ─── Data streams ─────────────────────────────────────────────────────────

    async def _request_streams(self):
        if not self._conn:
            return
        import pymavlink.mavutil as mavutil
        loop = asyncio.get_running_loop()
        streams = [
            (mavutil.mavlink.MAV_DATA_STREAM_RAW_SENSORS,     10),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS,  5),
            (mavutil.mavlink.MAV_DATA_STREAM_POSITION,        10),
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA1,          20),   # ATTITUDE
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA2,          10),   # VFR_HUD
            (mavutil.mavlink.MAV_DATA_STREAM_EXTRA3,           5),
        ]
        for sid, rate in streams:
            await loop.run_in_executor(
                None,
                lambda s=sid, r=rate: self._conn.mav.request_data_stream_send(
                    self._conn.target_system, self._conn.target_component, s, r, 1,
                )
            )
        log.info("[MAVLink] Data streams solicitados")

    # ─── Read loop — NON-BLOCKING ──────────────────────────────────────────────

    async def _read_loop(self):
        """
        blocking=False → el lock se libera en microsegundos, no en 1 segundo.
        Publica telemetría a 20Hz fijo aunque no lleguen mensajes.
        """
        loop       = asyncio.get_running_loop()
        poll_sleep = 1.0 / POLL_HZ
        publish_dt = 1.0 / PUBLISH_HZ
        log.info("[MAVLink] Read loop iniciado (non-blocking)")

        while True:
            try:
                if self.recv_paused:
                    await asyncio.sleep(0.02)
                    continue

                async with self._send_lock:
                    msg = await loop.run_in_executor(
                        None, lambda: self._conn.recv_match(blocking=False)
                    )

                if msg is not None:
                    parse_mavlink_message(msg, self.telemetry)
                    self.telemetry.ts = time.time()
                    await asyncio.sleep(0)   # ceder event loop
                else:
                    await asyncio.sleep(poll_sleep)

                now = time.time()
                if now - self._last_publish >= publish_dt:
                    self._last_publish = now
                    await self._publish()

            except asyncio.CancelledError:
                log.info("[MAVLink] Read loop cancelado")
                break
            except Exception as exc:
                log.error("[MAVLink] Error en read loop: %s", exc)
                self._connected = False
                break   # start_loop() reintentará

    # ─── Publish ──────────────────────────────────────────────────────────────

    async def _publish(self):
        snapshot = self.telemetry.to_dict()
        if self.telemetry_queue.full():
            try:
                self.telemetry_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        await self.telemetry_queue.put(snapshot)

    # ─── Mock loop ────────────────────────────────────────────────────────────

    async def _mock_loop(self):
        log.info("[MAVLink] Mock activo")
        self.telemetry.mode               = "STABILIZE"
        self.telemetry.mode_num           = 0
        self.telemetry.armed              = False
        self.telemetry.alt_rel            = 0.0
        self.telemetry.satellites         = 0
        self.telemetry.hdop               = 99.9
        self.telemetry.battery_voltage    = 0.0
        self.telemetry.battery_remaining  = -1

        while True:
            try:
                await asyncio.sleep(1.0 / PUBLISH_HZ)
                lat, lon = self._mock_home
                self.telemetry.ts  = time.time()
                self.telemetry.lat = lat
                self.telemetry.lon = lon
                await self._publish()
            except asyncio.CancelledError:
                log.info("[MAVLink] Mock cancelado")
                break
            except Exception as exc:
                log.error("[MAVLink] Error mock: %s", exc)
                await asyncio.sleep(1)

    # ─── Helpers ──────────────────────────────────────────────────────────────

    def set_mock_home(self, lat: float, lon: float) -> None:
        self._mock_home = (lat, lon)

    async def send_message(self, msg_builder):
        if self._use_mock:
            return
        async with self._send_lock:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, msg_builder)

    async def _cancel_io_tasks(self):
        for task in (self._read_task, self._mock_task):
            if task and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        if self._conn:
            try:
                self._conn.close()
            except Exception:
                pass
        self._conn      = None
        self._connected = False
        self._read_task = None
        self._mock_task = None

    async def close(self):
        self._running = False
        await self._cancel_io_tasks()
        log.info("[MAVLink] Conexión cerrada")
