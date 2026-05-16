"""
fleet.py — Endpoints REST para gestión de flota de drones y misiones.
Usa Motor (async MongoDB driver).

Rutas:
  GET  /api/fleet/drones              → Lista todos los drones
  GET  /api/fleet/drones/available    → Solo drones disponibles
  PUT  /api/fleet/drones/{id}/status  → Cambiar estado de un dron
  GET  /api/fleet/missions            → Historial de misiones (últimas 20)
  POST /api/fleet/missions            → Crear registro de nueva misión
  PUT  /api/fleet/missions/{id}/end   → Cerrar misión con score y stats
  POST /api/fleet/missions/{id}/telemetry → Guardar batch telemetría post-misión
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

log = logging.getLogger("gw.fleet")
router = APIRouter(prefix="/api/fleet", tags=["fleet"])


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _str_id(doc: dict) -> dict:
    """Convierte ObjectId a str para que FastAPI pueda serializar."""
    doc["id"] = str(doc.pop("_id"))
    if doc.get("last_mission_id"):
        doc["last_mission_id"] = str(doc["last_mission_id"])
    if doc.get("drone_id"):
        doc["drone_id"] = str(doc["drone_id"])
    return doc


def _get_db(request: Request):
    return request.app.state.db


# ─── Schemas Pydantic ─────────────────────────────────────────────────────────

class DroneCreate(BaseModel):
    call_sign:      str
    model:          str
    type:           str   # "reconnaissance" | "tanker"
    autonomy_min:   int   = 30
    area_mojado_m2: int   = 0
    notes:          str   = ""


class DroneStatusUpdate(BaseModel):
    status: str  # "available" | "on_mission" | "maintenance" | "retired"


class MissionCreate(BaseModel):
    zone: str
    drone_call_sign: Optional[str] = "GW-RECCO-01"
    wind_speed: Optional[int] = 0
    wind_dir: Optional[int] = 0


class MissionEnd(BaseModel):
    score: Optional[int] = 0
    fires_detected: Optional[int] = 0
    fires_extinguished: Optional[int] = 0
    geofence_coverage_pct: Optional[float] = 0.0
    drones_lost: Optional[int] = 0


class TelemetryBatch(BaseModel):
    records: list[dict]   # Lista de snapshots de telemetría


# ─── Drones ───────────────────────────────────────────────────────────────────

@router.post("/drones", status_code=201)
async def create_drone(body: DroneCreate, request: Request):
    db = _get_db(request)
    existing = await db["drones"].find_one({"call_sign": body.call_sign})
    if existing:
        raise HTTPException(status_code=409, detail=f"Call sign '{body.call_sign}' ya existe")
    now = datetime.now(timezone.utc)
    doc = {
        "call_sign":      body.call_sign,
        "model":          body.model,
        "type":           body.type,
        "autonomy_min":   body.autonomy_min,
        "area_mojado_m2": body.area_mojado_m2,
        "status":         "available",
        "flight_hours":   0.0,
        "last_mission_id": None,
        "notes":          body.notes,
        "created_at":     now,
    }
    result = await db["drones"].insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    log.info("[Fleet] Dron creado: %s (%s)", body.call_sign, body.model)
    return doc


@router.delete("/drones/{drone_id}", status_code=200)
async def retire_drone(drone_id: str, request: Request):
    db = _get_db(request)
    try:
        oid = ObjectId(drone_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de dron invalido")
    result = await db["drones"].update_one(
        {"_id": oid},
        {"$set": {"status": "retired"}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Dron no encontrado")
    doc = await db["drones"].find_one({"_id": oid})
    log.info("[Fleet] Dron dado de baja: %s", drone_id)
    return _str_id(doc)


@router.get("/drones")
async def list_drones(request: Request):
    db = _get_db(request)
    docs = await db["drones"].find().to_list(length=100)
    return [_str_id(d) for d in docs]


@router.get("/drones/available")
async def list_available_drones(request: Request):
    db = _get_db(request)
    docs = await db["drones"].find({"status": "available"}).to_list(length=100)
    return [_str_id(d) for d in docs]


@router.put("/drones/{drone_id}/status")
async def update_drone_status(drone_id: str, body: DroneStatusUpdate, request: Request):
    valid = {"available", "on_mission", "maintenance", "retired"}
    if body.status not in valid:
        raise HTTPException(status_code=400, detail=f"Estado inválido. Válidos: {valid}")

    db = _get_db(request)
    try:
        oid = ObjectId(drone_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de dron inválido")

    result = await db["drones"].update_one(
        {"_id": oid},
        {"$set": {"status": body.status}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Dron no encontrado")

    doc = await db["drones"].find_one({"_id": oid})
    return _str_id(doc)


# ─── Misiones ─────────────────────────────────────────────────────────────────

@router.get("/missions")
async def list_missions(request: Request):
    db = _get_db(request)
    docs = await db["missions"].find().sort("started_at", -1).to_list(length=20)
    return [_str_id(d) for d in docs]


@router.post("/missions", status_code=201)
async def create_mission(body: MissionCreate, request: Request):
    db = _get_db(request)

    # Buscar el dron por call_sign y marcarlo on_mission
    drone = await db["drones"].find_one({"call_sign": body.drone_call_sign})
    if not drone:
        raise HTTPException(status_code=404, detail=f"Dron '{body.drone_call_sign}' no encontrado")
    if drone["status"] != "available":
        log.warning("[Fleet] Dron %s no disponible (status=%s)", body.drone_call_sign, drone["status"])

    now = datetime.now(timezone.utc)
    mission_doc = {
        "zone": body.zone,
        "drone_id": drone["_id"],
        "drone_call_sign": body.drone_call_sign,
        "started_at": now,
        "ended_at": None,
        "score": None,
        "fires_detected": None,
        "fires_extinguished": None,
        "geofence_coverage_pct": None,
        "drones_lost": None,
        "wind_speed": body.wind_speed,
        "wind_dir": body.wind_dir,
    }
    result = await db["missions"].insert_one(mission_doc)
    mission_id = result.inserted_id

    # Marcar dron como on_mission
    await db["drones"].update_one(
        {"_id": drone["_id"]},
        {"$set": {"status": "on_mission", "last_mission_id": mission_id}},
    )

    log.info("[Fleet] Misión creada: %s zona=%s dron=%s", mission_id, body.zone, body.drone_call_sign)
    mission_doc["id"] = str(mission_id)
    mission_doc.pop("_id", None)
    mission_doc["drone_id"] = str(mission_doc["drone_id"])
    return mission_doc


@router.put("/missions/{mission_id}/end")
async def end_mission(mission_id: str, body: MissionEnd, request: Request):
    db = _get_db(request)
    try:
        oid = ObjectId(mission_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de misión inválido")

    mission = await db["missions"].find_one({"_id": oid})
    if not mission:
        raise HTTPException(status_code=404, detail="Misión no encontrada")

    now = datetime.now(timezone.utc)
    await db["missions"].update_one(
        {"_id": oid},
        {"$set": {
            "ended_at": now,
            "score": body.score,
            "fires_detected": body.fires_detected,
            "fires_extinguished": body.fires_extinguished,
            "geofence_coverage_pct": body.geofence_coverage_pct,
            "drones_lost": body.drones_lost,
        }},
    )

    # Liberar el dron
    if mission.get("drone_id"):
        await db["drones"].update_one(
            {"_id": mission["drone_id"]},
            {"$set": {"status": "available"}},
        )

    log.info("[Fleet] Misión %s cerrada. Score=%d", mission_id, body.score or 0)
    doc = await db["missions"].find_one({"_id": oid})
    return _str_id(doc)


@router.post("/missions/{mission_id}/telemetry", status_code=201)
async def save_telemetry(mission_id: str, body: TelemetryBatch, request: Request):
    """Guarda batch de telemetría post-misión en colección telemetry_logs."""
    db = _get_db(request)
    try:
        oid = ObjectId(mission_id)
    except Exception:
        raise HTTPException(status_code=400, detail="ID de misión inválido")

    if not body.records:
        return {"inserted": 0}

    docs = [{"mission_id": oid, **r} for r in body.records]
    result = await db["telemetry_logs"].insert_many(docs)
    log.info("[Fleet] Telemetría guardada: %d registros para misión %s",
             len(result.inserted_ids), mission_id)
    return {"inserted": len(result.inserted_ids)}
