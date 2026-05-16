"""
Galicia Wildfire — MAVLink telemetry para ArduCopter.
"""
import math
import time
from dataclasses import dataclass

# ─── Modos ArduCopter ─────────────────────────────────────────────────────────
ARDUPILOT_COPTER_MODES: dict[int, str] = {
    0:  "STABILIZE",
    1:  "ACRO",
    2:  "ALT_HOLD",
    3:  "AUTO",
    4:  "GUIDED",
    5:  "LOITER",
    6:  "RTL",
    7:  "CIRCLE",
    9:  "LAND",
    11: "DRIFT",
    13: "SPORT",
    15: "AUTOTUNE",
    16: "POSHOLD",
    17: "BRAKE",
    18: "THROW",
    21: "SMART_RTL",
}

UI_MODE_TO_ARDUPILOT: dict[str, int] = {
    "STABILIZE": 0,
    "ACRO":      1,
    "ALT_HOLD":  2,
    "AUTO":      3,
    "GUIDED":    4,
    "LOITER":    5,
    "RTL":       6,
    "LAND":      9,
    "POSHOLD":   16,
    "BRAKE":     17,
}

# Modos que aceptan RC_CHANNELS_OVERRIDE
MANUAL_MODES = {"STABILIZE", "ACRO", "ALT_HOLD", "LOITER", "POSHOLD", "SPORT"}


@dataclass
class TelemetryData:
    """Estado del copter en tiempo real."""
    lat: float = 0.0
    lon: float = 0.0
    alt_msl: float = 0.0
    alt_rel: float = 0.0        # AGL sobre home
    hdop: float = 99.9
    satellites: int = 0

    roll_deg: float = 0.0
    pitch_deg: float = 0.0
    yaw_deg: float = 0.0

    airspeed: float = 0.0
    groundspeed: float = 0.0
    vertical_speed: float = 0.0

    throttle_pct: int = 0
    mode: str = "STABILIZE"
    mode_num: int = 0
    armed: bool = False

    battery_voltage: float = 0.0
    battery_remaining: int = -1

    wp_num: int = 0
    wp_dist: float = 0.0
    nav_bearing: float = 0.0
    mission_total: int = 0

    ekf_ok: bool = False
    fence_enabled: bool = False

    ts: float = 0.0

    def to_dict(self) -> dict:
        return {
            "ts":             self.ts,
            "lat":            round(self.lat, 7),
            "lon":            round(self.lon, 7),
            "alt_msl":        round(self.alt_msl, 1),
            "alt_rel":        round(self.alt_rel, 1),
            "hdop":           round(self.hdop, 2),
            "satellites":     self.satellites,
            "roll":           round(self.roll_deg, 2),
            "pitch":          round(self.pitch_deg, 2),
            "yaw":            round(self.yaw_deg, 2),
            "airspeed":       round(self.airspeed, 1),
            "groundspeed":    round(self.groundspeed, 1),
            "vertical_speed": round(self.vertical_speed, 2),
            "throttle_pct":   self.throttle_pct,
            "mode":           self.mode,
            "mode_num":       self.mode_num,
            "armed":          self.armed,
            "battery_v":      round(self.battery_voltage, 2),
            "battery_pct":    self.battery_remaining,
            "wp_num":         self.wp_num,
            "wp_dist":        round(self.wp_dist, 1),
            "nav_bearing":    round(self.nav_bearing, 1),
            "mission_total":  self.mission_total,
            "ekf_ok":         self.ekf_ok,
            "fence_enabled":  self.fence_enabled,
        }


def parse_mavlink_message(msg, telemetry: TelemetryData) -> bool:
    msg_type = msg.get_type()

    if msg_type == "HEARTBEAT":
        telemetry.mode_num = msg.custom_mode
        telemetry.mode = ARDUPILOT_COPTER_MODES.get(msg.custom_mode, f"MODE_{msg.custom_mode}")
        telemetry.armed = bool(msg.base_mode & 0x80)
        return True

    if msg_type == "GLOBAL_POSITION_INT":
        telemetry.lat = msg.lat / 1e7
        telemetry.lon = msg.lon / 1e7
        telemetry.alt_msl = msg.alt / 1000.0
        telemetry.alt_rel = msg.relative_alt / 1000.0
        telemetry.vertical_speed = -msg.vz / 100.0   # vz positivo=abajo → invertir
        return True

    if msg_type == "ATTITUDE":
        telemetry.roll_deg  = math.degrees(msg.roll)
        telemetry.pitch_deg = math.degrees(msg.pitch)
        yaw = math.degrees(msg.yaw)
        telemetry.yaw_deg = yaw if yaw >= 0 else yaw + 360.0
        return True

    if msg_type == "VFR_HUD":
        telemetry.airspeed     = msg.airspeed
        telemetry.groundspeed  = msg.groundspeed
        telemetry.throttle_pct = msg.throttle
        return True

    if msg_type == "GPS_RAW_INT":
        telemetry.hdop       = msg.eph / 100.0 if msg.eph < 9999 else 99.9
        telemetry.satellites = msg.satellites_visible
        return True

    if msg_type == "SYS_STATUS":
        if msg.voltage_battery < 65535:
            telemetry.battery_voltage   = msg.voltage_battery / 1000.0
            telemetry.battery_remaining = msg.battery_remaining
        return True

    if msg_type == "NAV_CONTROLLER_OUTPUT":
        telemetry.wp_dist    = msg.wp_dist
        telemetry.nav_bearing = msg.target_bearing
        return True

    if msg_type == "MISSION_CURRENT":
        telemetry.wp_num = msg.seq
        return True

    if msg_type == "MISSION_COUNT":
        telemetry.mission_total = msg.count
        return True

    if msg_type == "EKF_STATUS_REPORT":
        telemetry.ekf_ok = bool(msg.flags & 0x1FF == 0x1FF)
        return True

    if msg_type == "FENCE_STATUS":
        telemetry.fence_enabled = bool(msg.breach_status == 0)
        return True

    return False
