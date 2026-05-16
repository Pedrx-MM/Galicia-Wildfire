"""
Galicia Wildfire — Comandos MAVLink para ArduCopter.
Patron DS: rc_override sin restriccion de modo, ARM con confirmacion por telemetria.
"""
import asyncio
import logging
from mavlink.telemetry import UI_MODE_TO_ARDUPILOT, ARDUPILOT_COPTER_MODES

log = logging.getLogger("gw.commands")


class CommandSender:

    def __init__(self, mav):
        self._mav = mav

    @property
    def _conn(self):
        return self._mav._conn

    def _available(self) -> bool:
        if self._mav.use_mock:
            return False
        if not self._mav.connected or not self._conn:
            log.warning("[CMD] Rechazado: MAVLink no conectado")
            return False
        return True

    async def _run(self, fn):
        loop = asyncio.get_running_loop()
        async with self._mav._send_lock:
            return await loop.run_in_executor(None, fn)

    # ─── Arm / Disarm ────────────────────────────────────────────────────────

    async def arm(self, force: bool = False) -> bool:
        log.info("[CMD] ARM force=%s", force)
        if self._mav.use_mock:
            self._mav.telemetry.armed = True
            return True
        if not self._available():
            return False
        param2 = 21196.0 if force else 0.0
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                400, 0, 1.0, param2, 0, 0, 0, 0, 0,
            )
        )
        for _ in range(60):
            await asyncio.sleep(0.1)
            if self._mav.telemetry.armed:
                log.info("[CMD] ARM confirmado por telemetria")
                return True
        log.warning("[CMD] ARM enviado pero no confirmado en 6s")
        return False

    async def disarm(self, force: bool = False) -> bool:
        log.info("[CMD] DISARM force=%s", force)
        if self._mav.use_mock:
            self._mav.telemetry.armed = False
            return True
        if not self._available():
            return False
        param2 = 21196.0 if force else 0.0
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                400, 0, 0.0, param2, 0, 0, 0, 0, 0,
            )
        )
        return True

    # ─── Modo de vuelo ───────────────────────────────────────────────────────

    async def set_mode(self, mode_name: str) -> bool:
        mode_num = UI_MODE_TO_ARDUPILOT.get(mode_name.upper())
        if mode_num is None:
            log.warning("[CMD] Modo desconocido: %s", mode_name)
            return False
        log.info("[CMD] SET_MODE %s (%d)", mode_name, mode_num)
        if self._mav.use_mock:
            self._mav.telemetry.mode_num = mode_num
            self._mav.telemetry.mode = ARDUPILOT_COPTER_MODES.get(mode_num, mode_name)
            return True
        if not self._available():
            return False
        import pymavlink.mavutil as mavutil
        await self._run(
            lambda: self._conn.mav.set_mode_send(
                self._conn.target_system,
                mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                mode_num,
            )
        )
        return True

    # ─── Takeoff (GUIDED) ────────────────────────────────────────────────────

    async def takeoff(self, alt_m: float = 10.0) -> bool:
        log.info("[CMD] TAKEOFF alt=%.1fm AGL", alt_m)
        if self._mav.use_mock:
            self._mav.telemetry.mode = "GUIDED"
            return True
        if not self._available():
            return False
        await self.set_mode("GUIDED")
        await asyncio.sleep(0.5)
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                22, 0,
                0, 0, 0, 0,
                self._mav.telemetry.lat,
                self._mav.telemetry.lon,
                float(alt_m),
            )
        )
        return True

    # ─── Land / RTL ──────────────────────────────────────────────────────────

    async def land(self) -> bool:
        return await self.set_mode("LAND")

    async def rtl(self) -> bool:
        return await self.set_mode("RTL")

    # ─── RC Override (WASD) ──────────────────────────────────────────────────

    async def rc_override(self, roll: int = 1500, pitch: int = 1500,
                          throttle: int = 1500, yaw: int = 1500) -> bool:
        if not self._available():
            return False
        await self._run(
            lambda: self._conn.mav.rc_channels_override_send(
                self._conn.target_system, self._conn.target_component,
                roll, pitch, throttle, yaw,
                0, 0, 0, 0,
            )
        )
        return True

    # ─── Geofence Q/E ────────────────────────────────────────────────────────

    async def fence_enable(self) -> None:
        log.info("[CMD] FENCE ENABLE")
        if self._mav.use_mock:
            self._mav.telemetry.fence_enabled = True
            return
        if not self._available():
            return
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                207, 0,
                1.0, 0, 0, 0, 0, 0, 0,
            )
        )

    async def fence_disable(self) -> None:
        log.info("[CMD] FENCE DISABLE")
        if self._mav.use_mock:
            self._mav.telemetry.fence_enabled = False
            return
        if not self._available():
            return
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                207, 0,
                0.0, 0, 0, 0, 0, 0, 0,
            )
        )

    # ─── Mision ──────────────────────────────────────────────────────────────

    async def start_mission(self) -> bool:
        if self._mav.use_mock:
            return True
        if not self._available():
            return False
        await self.set_mode("GUIDED")
        await asyncio.sleep(0.6)
        ok = await self.arm(force=False)
        if not ok:
            log.warning("[CMD] start_mission: ARM fallido — abortando")
            return False
        await self._run(
            lambda: self._conn.mav.mission_set_current_send(
                self._conn.target_system, self._conn.target_component, 0,
            )
        )
        await asyncio.sleep(0.3)
        await self.set_mode("AUTO")
        log.info("[CMD] Mision AUTO iniciada")
        return True

    async def set_home(self, lat: float, lon: float, alt_m: float = 0.0) -> bool:
        log.info("[CMD] SET_HOME %.6f %.6f %.1f", lat, lon, alt_m)
        if self._mav.use_mock:
            return True
        if not self._available():
            return False
        await self._run(
            lambda: self._conn.mav.command_long_send(
                self._conn.target_system, self._conn.target_component,
                179, 0,
                0, 0, 0, 0, lat, lon, alt_m,
            )
        )
        return True
