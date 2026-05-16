"""
Galicia Wildfire — Rutas de simulación (arquitectura Docker/mavlink-bridge).

POST /api/simulation/restart-at   — posiciona el sim_drone en MongoDB en la base elegida
POST /api/simulation/upload-mission — convierte focos en waypoints y los guarda en sim_misiones
GET  /api/simulation/status        — estado actual de SITL + MAVLink
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

from config import settings

log = logging.getLogger("gw.routes.simulation")
router = APIRouter(prefix="/api/simulation", tags=["simulation"])

SIM_DRONE_ID = settings.SIM_DRONE_ID


def now():
    return datetime.now(timezone.utc)


class RestartAtRequest(BaseModel):
    lat: float
    lon: float
    alt_m: float = 0.0


class UploadMissionRequest(BaseModel):
    fires: list[dict]
    base: dict
    cruise_alt_m: float = 120.0
    loiter_time_s: float = 30.0


async def _get_altitude_opentopodata(lat: float, lon: float) -> float:
    try:
        import urllib.request
        import json
        url = f"https://api.opentopodata.org/v1/srtm30m?locations={lat},{lon}"
        loop = asyncio.get_running_loop()
        response = await asyncio.wait_for(
            loop.run_in_executor(None, lambda: urllib.request.urlopen(url, timeout=5).read()),
            timeout=6,
        )
        data = json.loads(response)
        elevation = data.get("results", [{}])[0].get("elevation", 0) or 0
        return float(elevation)
    except Exception as exc:
        log.warning("[SIM] OpenTopoData no disponible (%s), usando alt=0", exc)
        return 0.0


@router.post("/restart-at")
async def restart_sitl(req: RestartAtRequest, request: Request):
    """
    Posiciona el dron simulado en la base elegida.
    Escribe en MongoDB sim_drones → el mavlink-bridge y simulador-gw lo leen.
    No necesita WSL ni ArduPilot real.
    """
    db  = request.app.state.db
    mav = request.app.state.mavlink

    alt = req.alt_m if req.alt_m > 0 else await _get_altitude_opentopodata(req.lat, req.lon)
    log.info("[SIM] restart-at lat=%.6f lon=%.6f alt=%.1f", req.lat, req.lon, alt)

    # Actualizar HOME del mock para telemetría inmediata
    mav.set_mock_home(req.lat, req.lon)

    # Crear o resetear el sim_drone en MongoDB
    sim_drone = {
        "_id":               SIM_DRONE_ID,
        "estado":            "en_tierra",
        "modo":              "loiter",
        "armado":            False,
        "posicion":          {"lat": req.lat, "lon": req.lon, "alt_m": alt},
        "bateria_pct":       100.0,
        "velocidad_max_ms":  15.0,
        "consumo_w":         50.0,
        "bateria_max_wh":    40.0,
        "autonomia_min":     45,
        "actualizado_en":    now(),
    }
    await db["sim_drones"].replace_one(
        {"_id": SIM_DRONE_ID},
        sim_drone,
        upsert=True,
    )

    # Abortar cualquier misión activa anterior
    await db["sim_misiones"].update_many(
        {"drone_id": SIM_DRONE_ID, "estado": "activa"},
        {"$set": {"estado": "abortada", "finalizada_en": now(),
                  "motivo_fin": "nueva_mision_restart"}},
    )

    log.info("[SIM] sim_drone creado/reseteado en MongoDB en (%.5f, %.5f, %.1fm)",
             req.lat, req.lon, alt)

    return {
        "ok": True,
        "lat": req.lat,
        "lon": req.lon,
        "alt": alt,
        "message": "Dron simulado posicionado — mavlink-bridge emitiendo telemetría",
    }


@router.post("/upload-mission")
async def upload_mission(req: UploadMissionRequest, request: Request):
    """
    Convierte los focos de incendio en waypoints y los guarda en sim_misiones.
    El simulador-gw los ejecutará automáticamente cuando la misión esté activa.
    """
    db = request.app.state.db

    # Comprobar que el sim_drone existe
    drone = await db["sim_drones"].find_one({"_id": SIM_DRONE_ID})
    if not drone:
        raise HTTPException(
            status_code=400,
            detail="Dron simulado no inicializado. Llama primero a /restart-at",
        )

    base = req.base
    cruise_alt = req.cruise_alt_m

    # Construir waypoints en formato del simulador-gw
    waypoints = []

    # WP0 — despegue (en la base)
    waypoints.append({
        "tipo":  "despegue",
        "lat":   float(base["lat"]),
        "lon":   float(base["lon"]),
        "alt_m": 0.0,
    })

    # Un waypoint por foco de incendio
    for fire in req.fires:
        waypoints.append({
            "lat":   float(fire["lat"]),
            "lon":   float(fire["lon"]),
            "alt_m": cruise_alt,
        })

    # Último — retorno a base (aterrizaje)
    waypoints.append({
        "tipo":  "aterrizaje",
        "lat":   float(base["lat"]),
        "lon":   float(base["lon"]),
        "alt_m": 0.0,
    })

    # Abortar misiones activas previas
    await db["sim_misiones"].update_many(
        {"drone_id": SIM_DRONE_ID, "estado": {"$in": ["activa", "planificada"]}},
        {"$set": {"estado": "abortada", "finalizada_en": now(),
                  "motivo_fin": "reemplazada"}},
    )

    # Insertar nueva misión planificada
    mision = {
        "drone_id":        SIM_DRONE_ID,
        "nombre":          f"GW Mission — {len(req.fires)} focos",
        "estado":          "planificada",
        "waypoints":       waypoints,
        "waypoint_actual": 0,
        "ruta_recorrida":  [],
        "creada_en":       now(),
        "iniciada_en":     None,
        "finalizada_en":   None,
    }
    result = await db["sim_misiones"].insert_one(mision)
    log.info("[SIM] Misión creada: %s (%d focos, %d waypoints)",
             result.inserted_id, len(req.fires), len(waypoints))

    return {
        "ok":        True,
        "mision_id": str(result.inserted_id),
        "waypoints": len(waypoints),
        "fires":     len(req.fires),
    }


@router.get("/status")
async def sitl_status(request: Request):
    """Estado del simulador Docker + MAVLink para polling desde el frontend."""
    db  = request.app.state.db
    mav = request.app.state.mavlink

    drone  = await db["sim_drones"].find_one({"_id": SIM_DRONE_ID})
    mision = await db["sim_misiones"].find_one(
        {"drone_id": SIM_DRONE_ID, "estado": "activa"}
    )

    return {
        "sitl_mode":         "docker-bridge",
        "sitl_running":      drone is not None,
        "mavlink_connected": mav.connected,
        "mavlink_mock":      mav.use_mock,
        "sim_drone":         {
            "estado":  drone.get("estado") if drone else None,
            "modo":    drone.get("modo") if drone else None,
            "armado":  drone.get("armado") if drone else None,
            "bateria": drone.get("bateria_pct") if drone else None,
        },
        "mision_activa": mision is not None,
        "mision_estado": mision.get("estado") if mision else None,
    }
