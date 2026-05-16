"""
Galicia Wildfire — Fase 8: Motor del Enjambre.
Spec §10 — Pasadas boustrophedon + simulación de drones cisterna.

calc_swarm_routes(polygon, wind_dir_deg, base_lat, base_lon)
  → Divide el polígono en franjas de SWATH_WIDTH metros.
  → Reparte las franjas entre N drones (según área).
  → Devuelve la estructura de rutas lista para SwarmManager.

SwarmManager
  → Simula el movimiento de los drones a 25 m/s.
  → Descarga agua a 2 L/s mientras vuela.
  → RTB (vuelta a base) cuando se queda sin agua, recarga en 8s.
  → Emite swarm_update por asyncio.Queue cada EMIT_INTERVAL segundos.
"""
import asyncio
import logging
import math
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("gw.swarm")

# ─── Constantes ───────────────────────────────────────────────────────────────
SWATH_WIDTH_M  = 80     # metros entre pasadas paralelas
DRONE_SPEED    = 25.0   # m/s
WATER_CAP      = 200.0  # litros por carga
DISCHARGE_RATE = 2.0    # L/s durante la pasada
RELOAD_TIME    = 8.0    # s recargando en base
EMIT_INTERVAL  = 2.0    # s entre swarm_update WS
SIM_DT         = 0.25   # s de timestep interno

M_PER_DEG_LAT  = 111_320.0
ARRIVE_THRESH   = 15.0  # metros — umbral "llegué al waypoint"


def _m_per_deg_lon(lat: float) -> float:
    return M_PER_DEG_LAT * math.cos(math.radians(lat))


def _area_ha(ring: list) -> float:
    """Shoelace en metros → hectáreas. ring = [[lon, lat], ...]"""
    n = len(ring) - 1   # el último punto cierra el anillo (== primero)
    if n < 3:
        return 0.0
    c_lat  = sum(p[1] for p in ring[:n]) / n
    m_lon  = _m_per_deg_lon(c_lat)
    area   = 0.0
    for i in range(n):
        j     = (i + 1) % n
        xi    = ring[i][0] * m_lon
        yi    = ring[i][1] * M_PER_DEG_LAT
        xj    = ring[j][0] * m_lon
        yj    = ring[j][1] * M_PER_DEG_LAT
        area += xi * yj - xj * yi
    return abs(area) / 2 / 10_000


def _n_drones(area_ha: float) -> int:
    if area_ha < 5:   return 2
    if area_ha < 20:  return 4
    if area_ha < 50:  return 6
    return 8


# ─── Cálculo de rutas ─────────────────────────────────────────────────────────

def calc_swarm_routes(
    polygon:       dict,
    wind_dir_deg:  float,
    base_lat:      float,
    base_lon:      float,
) -> dict:
    """
    Calcula rutas boustrophedon para el enjambre y devuelve el dict
    con toda la información necesaria para SwarmManager.start().
    """
    ring = polygon["coordinates"][0]   # [[lon, lat], ...]

    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    min_lon, max_lon = min(lons), max(lons)
    min_lat, max_lat = min(lats), max(lats)
    c_lat = (min_lat + max_lat) / 2
    c_lon = (min_lon + max_lon) / 2
    m_lon = _m_per_deg_lon(c_lat)

    width_m  = (max_lon - min_lon) * m_lon
    height_m = (max_lat - min_lat) * M_PER_DEG_LAT

    # Número de franjas E-O (perpendicular a viento simplificado)
    n_swaths = max(1, round(width_m / SWATH_WIDTH_M))

    # Generar segmentos boustrophedon (alternando N-S / S-N)
    segments = []
    for i in range(n_swaths):
        lon_c = min_lon + (i + 0.5) * (max_lon - min_lon) / n_swaths
        if i % 2 == 0:
            a = {"lat": min_lat, "lon": lon_c}
            b = {"lat": max_lat, "lon": lon_c}
        else:
            a = {"lat": max_lat, "lon": lon_c}
            b = {"lat": min_lat, "lon": lon_c}
        segments.append((a, b))

    area  = _area_ha(ring)
    n_dr  = _n_drones(area)
    sw_id = f"sw_{uuid.uuid4().hex[:6]}"

    drones = []
    for d in range(n_dr):
        my_segs = segments[d::n_dr]       # round-robin
        route   = []
        for a, b in my_segs:
            route.append(a)
            route.append(b)

        drones.append({
            "id":    f"drone_{d + 1}",
            "route": route,
            "base":  {"lat": base_lat, "lon": base_lon},
        })

    # Duración estimada
    seg_len_m = height_m
    segs_per  = math.ceil(n_swaths / n_dr)
    reloads   = math.ceil(segs_per * seg_len_m * DISCHARGE_RATE / DRONE_SPEED / WATER_CAP)
    est_dur   = int(segs_per * seg_len_m / DRONE_SPEED + reloads * RELOAD_TIME)

    return {
        "swarm_id":            sw_id,
        "n_drones":            n_dr,
        "drones":              drones,
        "area_ha":             round(area, 1),
        "n_segments":          n_swaths,
        "estimated_duration_s": est_dur,
    }


# ─── Estado por dron ──────────────────────────────────────────────────────────

@dataclass
class DroneState:
    id:        str
    route:     list              # [{lat, lon}, ...]
    base_lat:  float
    base_lon:  float

    lat:       float = 0.0
    lon:       float = 0.0
    heading:   float = 0.0
    water:     float = WATER_CAP
    status:    str   = "flying"  # flying | rtb | reloading | done
    wp_idx:    int   = 0
    reload_end: float = 0.0

    @classmethod
    def from_dict(cls, d: dict) -> "DroneState":
        obj = cls(
            id       = d["id"],
            route    = d["route"],
            base_lat = d["base"]["lat"],
            base_lon = d["base"]["lon"],
            lat      = d["base"]["lat"],
            lon      = d["base"]["lon"],
        )
        return obj

    def snapshot(self) -> dict:
        return {
            "id":      self.id,
            "lat":     round(self.lat, 6),
            "lon":     round(self.lon, 6),
            "heading": round(self.heading, 1),
            "status":  self.status,
            "water":   round(self.water, 1),
            "wp_idx":  self.wp_idx,
        }


# ─── SwarmManager ─────────────────────────────────────────────────────────────

class SwarmManager:
    """Gestiona el ciclo de vida del enjambre y emite swarm_update vía Queue."""

    def __init__(self):
        self._drones: list[DroneState] = []
        self._queue:  asyncio.Queue    = asyncio.Queue(maxsize=2)
        self._task:   Optional[asyncio.Task] = None

    def start(self, swarm_data: dict) -> None:
        if self._task and not self._task.done():
            self._task.cancel()
        self._drones = [DroneState.from_dict(d) for d in swarm_data["drones"]]
        self._task   = asyncio.create_task(self._loop(), name="swarm-sim")
        log.info("[Swarm] %d drones lanzados sobre geofence %s",
                 len(self._drones), swarm_data.get("swarm_id"))

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    @property
    def queue(self) -> asyncio.Queue:
        return self._queue

    # ── Loop de simulación ────────────────────────────────────────────────────

    async def _loop(self) -> None:
        last_emit = time.monotonic()

        while True:
            try:
                await asyncio.sleep(SIM_DT)
                now = time.monotonic()

                for drone in self._drones:
                    self._step(drone, SIM_DT, now)

                if now - last_emit >= EMIT_INTERVAL:
                    payload = {
                        "type":   "swarm_update",
                        "drones": [d.snapshot() for d in self._drones],
                    }
                    if self._queue.full():
                        try:
                            self._queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    self._queue.put_nowait(payload)
                    last_emit = now

                # Terminar cuando todos estén en done
                if all(d.status == "done" for d in self._drones):
                    log.info("[Swarm] Misión completada por todos los drones")
                    # Emitir snapshot final
                    self._queue.put_nowait({
                        "type":   "swarm_update",
                        "drones": [d.snapshot() for d in self._drones],
                        "mission_complete": True,
                    })
                    break

            except asyncio.CancelledError:
                log.info("[Swarm] Loop cancelado")
                break
            except Exception as exc:
                log.error("[Swarm] Error en loop: %s", exc, exc_info=True)
                await asyncio.sleep(1.0)

    def _step(self, d: DroneState, dt: float, now: float) -> None:
        if d.status == "done":
            return

        if d.status == "reloading":
            if now >= d.reload_end:
                d.water  = WATER_CAP
                d.status = "flying"
            return

        if d.status == "rtb":
            arrived = self._move_to(d, d.base_lat, d.base_lon, dt)
            if arrived:
                d.status     = "reloading"
                d.reload_end = now + RELOAD_TIME
            return

        # flying: avanzar al siguiente waypoint
        if d.wp_idx >= len(d.route):
            d.status = "done"
            return

        target  = d.route[d.wp_idx]
        arrived = self._move_to(d, target["lat"], target["lon"], dt)
        if arrived:
            d.wp_idx += 1

        # Consumir agua mientras vuela (incluso si no llegó al WP)
        d.water = max(0.0, d.water - DISCHARGE_RATE * dt)
        if d.water <= 0:
            d.status = "rtb"

    @staticmethod
    def _move_to(d: DroneState, t_lat: float, t_lon: float, dt: float) -> bool:
        dlat  = t_lat - d.lat
        dlon  = t_lon - d.lon
        m_lon = _m_per_deg_lon(d.lat)
        dist  = math.hypot(dlat * M_PER_DEG_LAT, dlon * m_lon)

        if dist < ARRIVE_THRESH:
            d.lat, d.lon = t_lat, t_lon
            return True

        step = DRONE_SPEED * dt
        frac = min(1.0, step / dist)
        d.lat     += dlat * frac
        d.lon     += dlon * frac
        d.heading  = math.degrees(math.atan2(dlon * m_lon, dlat * M_PER_DEG_LAT)) % 360
        return False
