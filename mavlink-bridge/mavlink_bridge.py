"""
MAVLink Bridge — Galicia Wildfire
Lee el estado del dron simulado en MongoDB (colección sim_drones) y genera
paquetes MAVLink UDP auténticos hacia el backend FastAPI (udpin:0.0.0.0:14550).

Flujo:
  MongoDB (sim_drones) → este bridge → UDP:14550 → backend FastAPI → WebSocket → frontend

No se necesita ArduPilot real ni WSL. Este bridge emula un ArduCopter.
"""

import os
import time
import math
import logging
from datetime import datetime, timezone

from pymongo import MongoClient
from bson import ObjectId
from bson.errors import InvalidId

MONGO_URI     = os.environ.get("MONGO_URI", "mongodb://gw_admin:gw_pass@mongodb:27017/")
DB_NAME       = os.environ.get("DB_NAME", "galicia_wildfire")
SERVER_HOST   = os.environ.get("SERVER_HOST", "backend")
MAVLINK_PORT  = int(os.environ.get("MAVLINK_PORT", "14550"))
TICK_SEGUNDOS = float(os.environ.get("TICK_SEGUNDOS", "1"))
SIM_DRONE_ID  = os.environ.get("SIM_DRONE_ID", "gw-sim-01")
SYSID         = 1

# ArduCopter custom_mode values
AC_STABILIZE = 0
AC_ALT_HOLD  = 2
AC_AUTO      = 3
AC_LOITER    = 5
AC_RTL       = 6
AC_LAND      = 9

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [mavlink-bridge] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

_boot_time = time.time()
_prev_pos  = None
_prev_ts   = None
_vx = _vy = _vz = 0.0
_heading   = 0.0


def time_boot_ms():
    return int((time.time() - _boot_time) * 1000) & 0xFFFFFFFF


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1, lon1, lat2, lon2):
    dlon = math.radians(lon2 - lon1)
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    x = math.sin(dlon) * math.cos(rlat2)
    y = math.cos(rlat1) * math.sin(rlat2) - math.sin(rlat1) * math.cos(rlat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compute_velocity(pos, estado):
    global _prev_pos, _prev_ts, _vx, _vy, _vz, _heading
    now_t = time.time()
    if _prev_pos and _prev_ts:
        dt = now_t - _prev_ts
        if dt > 0 and estado not in ("en_tierra",):
            dist = haversine_m(_prev_pos["lat"], _prev_pos["lon"], pos["lat"], pos["lon"])
            if dist > 0.05:
                _heading = bearing_deg(_prev_pos["lat"], _prev_pos["lon"], pos["lat"], pos["lon"])
            R = 6_371_000
            _vy = (pos["lat"] - _prev_pos["lat"]) * math.pi / 180 * R / dt
            _vx = (pos["lon"] - _prev_pos["lon"]) * math.pi / 180 * R * math.cos(math.radians(pos["lat"])) / dt
            dalt = float(pos.get("alt_m", 0)) - float(_prev_pos.get("alt_m", 0))
            _vz = -dalt / dt
        else:
            _vx = _vy = _vz = 0.0
    _prev_pos = dict(pos)
    _prev_ts  = now_t
    return _vx, _vy, _vz


def get_mavlink_flags(estado, modo, armado, bateria):
    from pymavlink import mavutil
    MAV = mavutil.mavlink

    armed_flag = MAV.MAV_MODE_FLAG_SAFETY_ARMED if armado else 0

    if estado == "en_tierra":
        base_mode   = MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
        custom_mode = AC_STABILIZE
        sys_status  = MAV.MAV_STATE_STANDBY
    elif estado == "despegando":
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_GUIDED_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_ALT_HOLD
        sys_status  = MAV.MAV_STATE_ACTIVE
    elif estado == "aterrizando":
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_AUTO_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_LAND
        sys_status  = MAV.MAV_STATE_ACTIVE
    elif estado == "volando" and modo == "auto":
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_AUTO_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_AUTO
        sys_status  = MAV.MAV_STATE_ACTIVE
    elif estado == "volando" and modo == "rtl":
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_AUTO_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_RTL
        sys_status  = MAV.MAV_STATE_ACTIVE
    elif estado == "volando" and modo in ("land", "emergency"):
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_AUTO_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_LAND
        sys_status  = MAV.MAV_STATE_ACTIVE
    else:
        base_mode   = (armed_flag |
                       MAV.MAV_MODE_FLAG_STABILIZE_ENABLED |
                       MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED)
        custom_mode = AC_LOITER
        sys_status  = MAV.MAV_STATE_ACTIVE if armado else MAV.MAV_STATE_STANDBY

    if bateria <= 10.0 and estado not in ("en_tierra",):
        sys_status = MAV.MAV_STATE_EMERGENCY

    return base_mode, custom_mode, sys_status


def get_sim_drone(db):
    """Obtiene el documento sim_drones del dron activo."""
    drone = db["sim_drones"].find_one({"_id": SIM_DRONE_ID})
    return drone


def send_telemetry(conn, drone):
    global _heading
    from pymavlink import mavutil
    MAV = mavutil.mavlink

    estado  = drone.get("estado", "en_tierra")
    modo    = drone.get("modo", "loiter")
    armado  = bool(drone.get("armado", False))
    pos     = drone.get("posicion", {"lat": 42.60, "lon": -7.05, "alt_m": 0.0})
    bateria = float(drone.get("bateria_pct", 100.0))
    vel_max = float(drone.get("velocidad_max_ms", 15.0))
    consumo = float(drone.get("consumo_w", 50.0))

    lat = float(pos["lat"])
    lon = float(pos["lon"])
    alt = float(pos.get("alt_m", 0.0))

    vx, vy, vz  = compute_velocity(pos, estado)
    groundspeed = math.sqrt(vx ** 2 + vy ** 2)
    climb_rate  = -vz

    base_mode, custom_mode, sys_status = get_mavlink_flags(estado, modo, armado, bateria)
    tb = time_boot_ms()

    # ── HEARTBEAT ─────────────────────────────────────────────────────────────
    conn.mav.heartbeat_send(
        type=MAV.MAV_TYPE_QUADROTOR,
        autopilot=MAV.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=base_mode,
        custom_mode=custom_mode,
        system_status=sys_status,
        mavlink_version=3,
    )

    # ── GLOBAL_POSITION_INT ───────────────────────────────────────────────────
    lat_int  = int(lat * 1e7)
    lon_int  = int(lon * 1e7)
    alt_mm   = int(alt * 1000)
    vx_cm    = int(vy * 100)
    vy_cm    = int(vx * 100)
    vz_cm    = int(vz * 100)
    hdg_cdeg = int(_heading * 100) % 36000

    conn.mav.global_position_int_send(
        time_boot_ms=tb,
        lat=lat_int,
        lon=lon_int,
        alt=alt_mm,
        relative_alt=alt_mm,
        vx=vx_cm,
        vy=vy_cm,
        vz=vz_cm,
        hdg=hdg_cdeg,
    )

    # ── ATTITUDE ─────────────────────────────────────────────────────────────
    if estado == "volando" and groundspeed > 0.5:
        pitch = math.radians(-5.0)
        roll  = math.radians(3.0 * math.sin(time.time() * 0.2))
    elif estado == "despegando":
        pitch = math.radians(4.0)
        roll  = 0.0
    elif estado == "aterrizando":
        pitch = math.radians(-3.0)
        roll  = 0.0
    else:
        pitch = 0.0
        roll  = 0.0
    yaw = math.radians(_heading)

    conn.mav.attitude_send(
        time_boot_ms=tb,
        roll=roll,
        pitch=pitch,
        yaw=yaw,
        rollspeed=0.0,
        pitchspeed=0.0,
        yawspeed=0.0,
    )

    # ── VFR_HUD ───────────────────────────────────────────────────────────────
    if estado == "en_tierra":
        throttle = 0
    elif estado in ("despegando", "aterrizando"):
        throttle = 50
    else:
        throttle = int(min(100, (groundspeed / max(vel_max, 1.0)) * 100))

    conn.mav.vfr_hud_send(
        airspeed=float(groundspeed),
        groundspeed=float(groundspeed),
        heading=int(_heading),
        throttle=throttle,
        alt=float(alt),
        climb=float(climb_rate),
    )

    # ── SYS_STATUS ────────────────────────────────────────────────────────────
    voltage_mv = int(9800 + 1300 * bateria / 100.0)
    tension_v  = voltage_mv / 1000.0
    current_ca = int(consumo / max(tension_v, 0.1) * 100)

    conn.mav.sys_status_send(
        onboard_control_sensors_present=0,
        onboard_control_sensors_enabled=0,
        onboard_control_sensors_health=0,
        load=int(min(groundspeed / max(vel_max, 1) * 500, 1000)),
        voltage_battery=voltage_mv,
        current_battery=current_ca,
        battery_remaining=int(bateria),
        drop_rate_comm=0,
        errors_comm=0,
        errors_count1=0,
        errors_count2=0,
        errors_count3=0,
        errors_count4=0,
    )

    # ── GPS_RAW_INT ───────────────────────────────────────────────────────────
    conn.mav.gps_raw_int_send(
        time_usec=int(time.time() * 1e6),
        fix_type=3,
        lat=lat_int,
        lon=lon_int,
        alt=alt_mm,
        eph=100,
        epv=150,
        vel=int(groundspeed * 100),
        cog=hdg_cdeg,
        satellites_visible=12,
    )

    log.info(
        "[TX] %s/%s lat=%.5f lon=%.5f alt=%.1fm bat=%.1f%% armed=%s spd=%.1fm/s hdg=%.0f°",
        estado, modo, lat, lon, alt, bateria, armado, groundspeed, _heading,
    )


def send_idle_heartbeat(conn):
    from pymavlink import mavutil
    MAV = mavutil.mavlink
    conn.mav.heartbeat_send(
        type=MAV.MAV_TYPE_QUADROTOR,
        autopilot=MAV.MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode=MAV.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        custom_mode=AC_STABILIZE,
        system_status=MAV.MAV_STATE_STANDBY,
        mavlink_version=3,
    )


def main():
    log.info("MAVLink Bridge GW — destino UDP %s:%d", SERVER_HOST, MAVLINK_PORT)

    # Esperar MongoDB
    for intento in range(30):
        try:
            mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            mongo.admin.command("ping")
            log.info("✅ MongoDB conectado")
            break
        except Exception as e:
            log.warning("Intento %d/30 conectando a MongoDB: %s", intento + 1, e)
            time.sleep(2)
    else:
        log.error("No se pudo conectar a MongoDB. Saliendo.")
        raise SystemExit(1)

    db = mongo[DB_NAME]

    # Inicializar sim_drone si no existe
    if not db["sim_drones"].find_one({"_id": SIM_DRONE_ID}):
        db["sim_drones"].insert_one({
            "_id":               SIM_DRONE_ID,
            "estado":            "en_tierra",
            "modo":              "loiter",
            "armado":            False,
            "posicion":          {"lat": 42.60, "lon": -7.05, "alt_m": 0.0},
            "bateria_pct":       100.0,
            "velocidad_max_ms":  15.0,
            "consumo_w":         50.0,
            "bateria_max_wh":    40.0,
            "autonomia_min":     45,
        })
        log.info("✅ sim_drone inicializado con ID=%s", SIM_DRONE_ID)

    # Conexión MAVLink UDP de salida hacia el backend
    from pymavlink import mavutil
    target = f"udpout:{SERVER_HOST}:{MAVLINK_PORT}"
    log.info("Conectando MAVLink → %s", target)
    conn = mavutil.mavlink_connection(target, source_system=SYSID)
    log.info("✅ MAVLink listo. Comenzando emisión de telemetría...")

    idle_ticks = 0
    while True:
        t0 = time.monotonic()
        try:
            drone = get_sim_drone(db)
            if drone:
                idle_ticks = 0
                send_telemetry(conn, drone)
            else:
                idle_ticks += 1
                send_idle_heartbeat(conn)
                if idle_ticks % 30 == 1:
                    log.info("Sin sim_drone en MongoDB — emitiendo heartbeat idle...")
        except Exception as e:
            log.error("Error en tick: %s", e, exc_info=True)

        elapsed = time.monotonic() - t0
        time.sleep(max(0.0, TICK_SEGUNDOS - elapsed))


if __name__ == "__main__":
    main()
