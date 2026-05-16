"""
Motor de fuego — Fase 3: generación inicial de focos.
La propagación celular (autómata) se añade en Fase 6.
"""
import random
import math


# Bounding boxes de cada zona (aproximados a la extensión real)
ZONE_BBOXES = {
    "courel": {"min_lat": 42.575, "max_lat": 42.625, "min_lon": -7.090, "max_lon": -7.010},
    "eume":   {"min_lat": 43.375, "max_lat": 43.425, "min_lon": -8.090, "max_lon": -8.010},
    "suido":  {"min_lat": 42.345, "max_lat": 42.395, "min_lon": -8.310, "max_lon": -8.230},
    "pindo":  {"min_lat": 42.820, "max_lat": 42.860, "min_lon": -9.100, "max_lon": -9.040},
}

# Número de focos según dificultad (min, max)
FIRES_BY_DIFFICULTY = {
    "Media":    (1, 2),
    "Alta":     (2, 3),
    "Muy alta": (3, 4),
}

MIN_DIST_BETWEEN_FIRES_M = 800
MIN_DIST_FROM_BASE_M     = 500


def generate_fires(zone_id: str, difficulty: str,
                   base_lat: float, base_lon: float) -> list[dict]:
    """
    Genera entre 1 y 4 focos de incendio dentro del bounding box de la zona.
    Garantiza distancia mínima entre focos y respecto a la base.
    """
    bbox  = ZONE_BBOXES.get(zone_id, ZONE_BBOXES["courel"])
    lo, hi = FIRES_BY_DIFFICULTY.get(difficulty, (1, 2))
    n_fires = random.randint(lo, hi)

    fires   = []
    attempts = 0

    while len(fires) < n_fires and attempts < 300:
        attempts += 1
        lat = random.uniform(bbox["min_lat"], bbox["max_lat"])
        lon = random.uniform(bbox["min_lon"], bbox["max_lon"])

        if _distance_m(lat, lon, base_lat, base_lon) < MIN_DIST_FROM_BASE_M:
            continue
        if any(_distance_m(lat, lon, f["lat"], f["lon"]) < MIN_DIST_BETWEEN_FIRES_M
               for f in fires):
            continue

        fires.append({
            "id":        f"fire_{len(fires) + 1}",
            "lat":       round(lat, 6),
            "lon":       round(lon, 6),
            "intensity": 1.0,
            "area_m2":   500,
            "cells":     [],           # se rellena en Fase 6 (autómata celular)
        })

    return fires


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia Haversine en metros."""
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
