"""
Galicia Wildfire — Upload/download de misiones MAVLink para ArduPlane.
Usa recv_paused para ceder el socket durante la transferencia.
"""
import asyncio
import logging

log = logging.getLogger("gw.mission")

# Tipos de waypoint ArduPlane
MAV_CMD_NAV_WAYPOINT    = 16
MAV_CMD_NAV_LOITER_TIME = 19
MAV_CMD_NAV_RETURN      = 20
MAV_CMD_NAV_TAKEOFF     = 22
MAV_CMD_NAV_LAND        = 21

# Frame: global relativo al home
MAV_FRAME_GLOBAL_RELATIVE_ALT = 3


def fires_to_mission(fires: list[dict], base: dict, config: dict) -> list[dict]:
    """
    Convierte lista de focos de incendio en waypoints de misión ArduPlane.

    fires:  [{"lat": ..., "lon": ..., "intensity": ...}, ...]
    base:   {"lat": ..., "lon": ...}
    config: {"cruise_alt_m": 120, "loiter_time_s": 30, "approach_alt_m": 60}

    Orden de waypoints generado:
      0  Dummy (home, MAV_CMD_NAV_WAYPOINT)
      1  Takeoff
      2  Climb al primer foco
      N  Loiter sobre cada foco (descenso + pase + subida)
      last RTL
    """
    cruise_alt    = config.get("cruise_alt_m",   120)
    loiter_time   = config.get("loiter_time_s",   30)

    wps = []

    # WP0 — Home dummy (requerido por ArduPlane)
    wps.append({
        "seq": 0,
        "frame": MAV_FRAME_GLOBAL_RELATIVE_ALT,
        "command": MAV_CMD_NAV_WAYPOINT,
        "current": 0,
        "autocontinue": 1,
        "param1": 0, "param2": 0, "param3": 0, "param4": 0,
        "x": base["lat"], "y": base["lon"], "z": 0,
    })

    # WP1 — Takeoff
    wps.append({
        "seq": 1,
        "frame": MAV_FRAME_GLOBAL_RELATIVE_ALT,
        "command": MAV_CMD_NAV_TAKEOFF,
        "current": 1,
        "autocontinue": 1,
        "param1": 15,   # pitch
        "param2": 0, "param3": 0, "param4": 0,
        "x": base["lat"], "y": base["lon"], "z": cruise_alt,
    })

    # Un loiter por foco
    for i, fire in enumerate(fires, start=2):
        wps.append({
            "seq": i,
            "frame": MAV_FRAME_GLOBAL_RELATIVE_ALT,
            "command": MAV_CMD_NAV_LOITER_TIME,
            "current": 0,
            "autocontinue": 1,
            "param1": loiter_time,  # segundos
            "param2": 0, "param3": 0, "param4": 0,
            "x": fire["lat"], "y": fire["lon"], "z": cruise_alt,
        })

    # Último — RTL
    wps.append({
        "seq": len(wps),
        "frame": MAV_FRAME_GLOBAL_RELATIVE_ALT,
        "command": MAV_CMD_NAV_RETURN,
        "current": 0,
        "autocontinue": 1,
        "param1": 0, "param2": 0, "param3": 0, "param4": 0,
        "x": 0, "y": 0, "z": 0,
    })

    return wps


class MissionManager:
    """Upload y download de misiones MAVLink."""

    def __init__(self, mav):
        self._mav = mav

    def _conn(self):
        return self._mav._conn

    async def upload_mission(self, waypoints: list[dict], timeout: float = 30.0) -> bool:
        """
        Sube waypoints al autopiloto. Bloquea recv_paused durante la operación.
        Devuelve True en éxito.
        """
        if self._mav.use_mock:
            log.info("[MISSION] Mock: misión con %d waypoints aceptada", len(waypoints))
            self._mav.telemetry.mission_total = len(waypoints)
            return True

        loop = asyncio.get_running_loop()
        self._mav.recv_paused = True
        try:
            success = await asyncio.wait_for(
                loop.run_in_executor(None, self._upload_sync, waypoints),
                timeout=timeout,
            )
            return success
        except asyncio.TimeoutError:
            log.error("[MISSION] Upload timeout")
            return False
        finally:
            self._mav.recv_paused = False

    def _upload_sync(self, waypoints: list[dict]) -> bool:
        """Protocolo de upload MAVLink síncrono (ejecutar en executor)."""
        try:
            conn = self._conn()
            count = len(waypoints)

            conn.mav.mission_count_send(conn.target_system, conn.target_component, count)

            for wp in waypoints:
                msg = conn.recv_match(type="MISSION_REQUEST", blocking=True, timeout=5)
                if msg is None:
                    log.error("[MISSION] No MISSION_REQUEST recibido en seq %d", wp["seq"])
                    return False

                conn.mav.mission_item_int_send(
                    conn.target_system,
                    conn.target_component,
                    wp["seq"],
                    wp["frame"],
                    wp["command"],
                    wp["current"],
                    wp["autocontinue"],
                    wp["param1"], wp["param2"], wp["param3"], wp["param4"],
                    int(wp["x"] * 1e7),
                    int(wp["y"] * 1e7),
                    wp["z"],
                )

            ack = conn.recv_match(type="MISSION_ACK", blocking=True, timeout=5)
            if ack and ack.type == 0:   # MAV_MISSION_ACCEPTED
                log.info("[MISSION] Upload OK — %d waypoints", count)
                return True

            log.error("[MISSION] ACK inesperado: %s", ack)
            return False

        except Exception as exc:
            log.error("[MISSION] Error upload: %s", exc)
            return False

    async def clear_mission(self) -> bool:
        """Borra la misión actual del autopiloto."""
        if self._mav.use_mock:
            self._mav.telemetry.mission_total = 0
            return True

        loop = asyncio.get_running_loop()
        self._mav.recv_paused = True
        try:
            return await loop.run_in_executor(None, self._clear_sync)
        finally:
            self._mav.recv_paused = False

    def _clear_sync(self) -> bool:
        try:
            conn = self._conn()
            conn.mav.mission_clear_all_send(conn.target_system, conn.target_component)
            ack = conn.recv_match(type="MISSION_ACK", blocking=True, timeout=5)
            return ack is not None and ack.type == 0
        except Exception as exc:
            log.error("[MISSION] Error clear: %s", exc)
            return False
