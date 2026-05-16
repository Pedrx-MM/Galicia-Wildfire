"""
Endpoints de juego: zonas, generación de misión.
POST /api/game/new-game  → crea estado de misión (wind + fires)
GET  /api/game/zones     → metadatos de las 4 zonas
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from game.wind import generate_wind
from game.fire_engine import generate_fires
from game.swarm import calc_swarm_routes

router = APIRouter(prefix="/api/game", tags=["game"])

# ─── Metadatos de zonas (fuente de verdad del backend) ────────────────────────
ZONES: dict[str, dict] = {
    "courel": {
        "id":          "courel",
        "name":        "Serra do Courel",
        "center":      [-7.05, 42.60],
        "zoom":        13,
        "description": "Bosque denso de robles y castaños. Pendientes pronunciadas.",
        "area_km2":    18,
        "difficulty":  "Alta",
    },
    "eume": {
        "id":          "eume",
        "name":        "Fragas do Eume",
        "center":      [-8.05, 43.40],
        "zoom":        13,
        "description": "Bosque atlántico costero. Viento predominante del noroeste.",
        "area_km2":    12,
        "difficulty":  "Media",
    },
    "suido": {
        "id":          "suido",
        "name":        "Serra do Suído",
        "center":      [-8.27, 42.37],
        "zoom":        13,
        "description": "Matorral y eucalipto. Propagación rápida en verano.",
        "area_km2":    22,
        "difficulty":  "Muy alta",
    },
    "pindo": {
        "id":          "pindo",
        "name":        "Monte Pindo",
        "center":      [-9.07, 42.84],
        "zoom":        13,
        "description": "Granito y pino costero. Relieve irregular.",
        "area_km2":    9,
        "difficulty":  "Media",
    },
}


# ─── Schemas ──────────────────────────────────────────────────────────────────
class NewGameRequest(BaseModel):
    zone:     str   = Field(..., description="ID de zona: courel | eume | suido | pindo")
    base_lat: float = Field(..., description="Latitud de la base de operaciones")
    base_lon: float = Field(..., description="Longitud de la base de operaciones")


class StartFiresRequest(BaseModel):
    fires:          list[dict] = Field(..., description="Lista de focos del game_state")
    wind_dir_deg:   float      = Field(..., description="Dirección del viento (°, 0=N)")
    wind_speed_kmh: float      = Field(..., description="Velocidad del viento (km/h)")
    difficulty:     str        = Field(default="Media", description="Dificultad: Muy alta | Alta | Media | Baja")


class LaunchSwarmRequest(BaseModel):
    polygon:      dict       = Field(..., description="GeoJSON Polygon de la geofence")
    fire_ids:     list[str]  = Field(default_factory=list, description="IDs de focos atacados")
    wind_dir_deg: float      = Field(..., description="Dirección del viento (°, 0=N)")
    base_lat:     float      = Field(..., description="Latitud de la base de operaciones")
    base_lon:     float      = Field(..., description="Longitud de la base de operaciones")


# ─── Endpoints ────────────────────────────────────────────────────────────────
@router.post("/launch-swarm")
async def launch_swarm(req: LaunchSwarmRequest, request: Request):
    """
    Calcula rutas boustrophedon y arranca la simulación del enjambre.
    Devuelve la estructura completa con drones + rutas + duración estimada.
    """
    swarm_data  = calc_swarm_routes(req.polygon, req.wind_dir_deg, req.base_lat, req.base_lon)
    swarm_mgr   = request.app.state.swarm_manager
    swarm_mgr.start(swarm_data)
    return swarm_data


@router.post("/start-fires")
async def start_fires(req: StartFiresRequest, request: Request):
    """
    Inicializa (o reinicia) el motor de propagación de incendios.
    Llamar desde el simulador justo al arrancar la pantalla de vuelo.
    """
    fire_mgr = request.app.state.fire_manager
    fire_mgr.start(req.fires, req.wind_dir_deg, req.wind_speed_kmh, req.difficulty)
    return {"status": "ok", "fire_count": len(req.fires), "difficulty": req.difficulty}


@router.get("/zones")
async def get_zones():
    """Lista de zonas disponibles con todos sus metadatos."""
    return {"zones": list(ZONES.values())}


@router.post("/new-game")
async def new_game(req: NewGameRequest):
    """
    Genera el estado inicial de una misión:
    - Viento aleatorio (dirección + velocidad)
    - Focos de incendio dentro del bounding box de la zona
    Devuelve el game_state completo que el frontend guarda en sessionStorage.
    """
    if req.zone not in ZONES:
        raise HTTPException(
            status_code=404,
            detail=f"Zona '{req.zone}' no existe. Válidas: {list(ZONES.keys())}",
        )

    zone = ZONES[req.zone]
    wind = generate_wind()
    fires = generate_fires(
        zone_id    = req.zone,
        difficulty = zone["difficulty"],
        base_lat   = req.base_lat,
        base_lon   = req.base_lon,
    )

    return {
        "game_id":    f"gw_{uuid.uuid4().hex[:8]}",
        "zone":       req.zone,
        "zone_name":  zone["name"],
        "difficulty": zone["difficulty"],
        "base": {
            "lat": round(req.base_lat, 6),
            "lon": round(req.base_lon, 6),
        },
        "wind":        wind,
        "fires":       fires,
        "fire_count":  len(fires),
        "created_at":  datetime.now(timezone.utc).isoformat(),
    }
