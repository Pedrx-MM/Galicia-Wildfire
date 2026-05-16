"""
Galicia Wildfire — Fase 6: Autómata celular de propagación de incendios.

Cada celda mide CELL_SIZE_M × CELL_SIZE_M metros.
Estados: UNBURNED (0) → BURNING (1) → BURNED (2).
El motor ejecuta un paso cada SPREAD_STEP segundos (tiempo real).
Emite snapshots comprimidos (solo celdas ≠ UNBURNED) cada EMIT_INTERVAL segundos
a través de un asyncio.Queue que main.py redirige al WS broadcaster.
"""
import asyncio
import logging
import math
import random
import time
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("gw.fire")

# ─── Constantes ───────────────────────────────────────────────────────────────
M_PER_DEG_LAT   = 111_320.0   # metros por grado de latitud (aprox)

UNBURNED  = 0
BURNING   = 1
BURNED    = 2

CELL_SIZE_M     = 50     # tamaño de celda en metros
BURN_DURATION   = 90.0   # segundos que tarda una celda en quemarse completamente
SPREAD_STEP     = 10.0   # segundos entre pasos del autómata (se ajusta por dificultad)
EMIT_INTERVAL   = 5.0    # segundos entre emisiones de fire_update
INIT_RADIUS     = 3      # radio inicial de celdas alrededor de cada foco
BASE_SPREAD_P   = 0.28   # probabilidad base de propagación a vecino libre

# Factor de dificultad: (multiplicador probabilidad, segundos entre pasos)
DIFFICULTY_PARAMS: dict[str, tuple[float, float]] = {
    "muy alta": (1.70, 6.0),
    "alta":     (1.30, 8.0),
    "media":    (1.00, 10.0),
    "baja":     (0.75, 12.0),
}


# ─── Celda ────────────────────────────────────────────────────────────────────

@dataclass
class Cell:
    row: int
    col: int
    lat: float
    lon: float
    state: int = UNBURNED
    ignited_at: Optional[float] = None  # monotonic time cuando se inició la ignición

    def to_dict(self) -> dict:
        return {
            "row":   self.row,
            "col":   self.col,
            "lat":   self.lat,
            "lon":   self.lon,
            "state": self.state,
        }


# ─── Motor de propagación ─────────────────────────────────────────────────────

class FireSpreadEngine:
    """
    Autómata celular en cuadrícula de 50 m.
    Una instancia gestiona todos los focos de una partida.
    """

    def __init__(
        self,
        fires:           list[dict],
        wind_dir_deg:    float,
        wind_speed_kmh:  float,
        difficulty:      str = "Media",
    ):
        # El viento sopla DESDE wind_dir_deg hacia su opuesto.
        # La propagación va en la dirección del viento.
        self._wind_dir_rad = math.radians(wind_dir_deg)
        self._wind_speed   = wind_speed_kmh

        key = difficulty.lower().strip()
        p_factor, self._spread_step = DIFFICULTY_PARAMS.get(key, DIFFICULTY_PARAMS["media"])
        self._spread_p_factor = p_factor
        log.info("[Fire] Dificultad '%s' → p×%.2f step=%.0fs", difficulty, p_factor, self._spread_step)

        self._cells: dict[tuple[int, int], Cell] = {}
        self._origin: Optional[tuple[float, float]] = None  # (lat, lon)

        for fire in fires:
            self._init_fire(fire["lat"], fire["lon"])

    # ─── Inicialización ───────────────────────────────────────────────────────

    def _m_per_deg_lon(self, lat: float) -> float:
        return M_PER_DEG_LAT * math.cos(math.radians(lat))

    def _add_cell(self, r: int, c: int, state: int = UNBURNED) -> None:
        if (r, c) in self._cells:
            return
        origin_lat, origin_lon = self._origin
        lat = origin_lat + r * CELL_SIZE_M / M_PER_DEG_LAT
        lon = origin_lon + c * CELL_SIZE_M / self._m_per_deg_lon(origin_lat)
        now = time.monotonic()
        self._cells[(r, c)] = Cell(
            row=r, col=c,
            lat=round(lat, 6), lon=round(lon, 6),
            state=state,
            ignited_at=now if state == BURNING else None,
        )

    def _init_fire(self, lat: float, lon: float) -> None:
        """Crea bloque de celdas alrededor de un foco; la celda central empieza BURNING."""
        if self._origin is None:
            self._origin = (lat, lon)

        origin_lat, origin_lon = self._origin
        center_r = round((lat - origin_lat) * M_PER_DEG_LAT / CELL_SIZE_M)
        center_c = round((lon - origin_lon) * self._m_per_deg_lon(origin_lat) / CELL_SIZE_M)

        for dr in range(-INIT_RADIUS, INIT_RADIUS + 1):
            for dc in range(-INIT_RADIUS, INIT_RADIUS + 1):
                state = BURNING if (dr == 0 and dc == 0) else UNBURNED
                self._add_cell(center_r + dr, center_c + dc, state)

    # ─── Paso del autómata ────────────────────────────────────────────────────

    def step(self) -> None:
        """Un ciclo del autómata: aging BURNING→BURNED + propagación."""
        now = time.monotonic()

        # 1. Celdas que llevan más de BURN_DURATION pasan a BURNED
        for cell in self._cells.values():
            if cell.state == BURNING and cell.ignited_at is not None:
                if now - cell.ignited_at >= BURN_DURATION:
                    cell.state = BURNED

        # 2. Propagación desde cada celda BURNING a sus 8 vecinos
        new_ignitions: list[tuple[int, int]] = []

        for (r, c), cell in list(self._cells.items()):
            if cell.state != BURNING:
                continue
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc

                    # Expandir la rejilla si el vecino aún no existe
                    if (nr, nc) not in self._cells:
                        self._add_cell(nr, nc, UNBURNED)

                    if self._cells[(nr, nc)].state != UNBURNED:
                        continue

                    if random.random() < self._spread_prob(dr, dc):
                        new_ignitions.append((nr, nc))

        # Aplicar igniciones (set elimina duplicados)
        for key in set(new_ignitions):
            self._cells[key].state      = BURNING
            self._cells[key].ignited_at = now

    def _spread_prob(self, dr: int, dc: int) -> float:
        """
        Probabilidad de propagación hacia el vecino (dr, dc).
        Mayor en la dirección downwind; penalizada a sotavento.
        """
        # Vector normalizado hacia el vecino
        mag = math.sqrt(dr ** 2 + dc ** 2)
        if mag == 0:
            return 0.0

        # El viento sopla HACIA (sin(dir), cos(dir)) en ejes (E, N)
        # El vecino está en (dc, dr) — col=este, row=norte
        wind_e = math.sin(self._wind_dir_rad)
        wind_n = math.cos(self._wind_dir_rad)
        # dot product normalizado: 1=downwind, -1=upwind
        dot = (wind_e * dc + wind_n * dr) / mag

        wind_factor = 1.0 + 0.55 * dot * (1.0 + self._wind_speed / 55.0)
        return float(min(0.92, max(0.02, BASE_SPREAD_P * self._spread_p_factor * wind_factor)))

    # ─── Consultas ────────────────────────────────────────────────────────────

    def snapshot(self) -> list[dict]:
        """Solo las celdas que no son UNBURNED (más compacto para WS)."""
        return [c.to_dict() for c in self._cells.values() if c.state != UNBURNED]

    def is_active(self) -> bool:
        return any(c.state == BURNING for c in self._cells.values())


# ─── FireManager — ciclo de vida + cola WS ────────────────────────────────────

class FireManager:
    """
    Singleton de partida: arranca el motor cuando el usuario lanza la misión,
    emite fire_update periódicamente a través de un asyncio.Queue.
    """

    def __init__(self):
        self._engine: Optional[FireSpreadEngine] = None
        self._queue:  asyncio.Queue = asyncio.Queue(maxsize=2)
        self._task:   Optional[asyncio.Task] = None

    # ── API pública ───────────────────────────────────────────────────────────

    def start(
        self,
        fires:          list[dict],
        wind_dir_deg:   float,
        wind_speed_kmh: float,
        difficulty:     str = "Media",
    ) -> None:
        """Inicializa el motor y arranca el loop. Se puede llamar varias veces (reinicia)."""
        if self._task and not self._task.done():
            self._task.cancel()

        self._engine = FireSpreadEngine(fires, wind_dir_deg, wind_speed_kmh, difficulty)
        self._task   = asyncio.create_task(self._loop(), name="fire-spread")
        log.info("[Fire] Motor iniciado — %d foco(s) dificultad=%s", len(fires), difficulty)

    def stop(self) -> None:
        if self._task and not self._task.done():
            self._task.cancel()

    @property
    def queue(self) -> asyncio.Queue:
        return self._queue

    # ── Loop interno ──────────────────────────────────────────────────────────

    async def _loop(self) -> None:
        last_step = time.monotonic()
        last_emit = time.monotonic()

        while True:
            try:
                await asyncio.sleep(1.0)
                now = time.monotonic()

                if now - last_step >= self._engine._spread_step:
                    self._engine.step()
                    last_step = now
                    log.debug("[Fire] Paso ejecutado")

                if now - last_emit >= EMIT_INTERVAL:
                    cells = self._engine.snapshot()
                    payload = {"type": "fire_update", "cells": cells}
                    if self._queue.full():
                        try:
                            self._queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    self._queue.put_nowait(payload)
                    last_emit = now

                if not self._engine.is_active():
                    log.info("[Fire] Todos los focos extinguidos — motor detenido")
                    break

            except asyncio.CancelledError:
                log.info("[Fire] Motor cancelado")
                break
            except Exception as exc:
                log.error("[Fire] Error en loop: %s", exc, exc_info=True)
                await asyncio.sleep(2.0)
