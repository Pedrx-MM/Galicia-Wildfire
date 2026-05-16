"""
mongo_init.py — Inserta flota inicial de drones si la coleccion esta vacia.
Se llama desde el lifespan de FastAPI al arrancar.
"""
import logging
from datetime import datetime, timezone

log = logging.getLogger("gw.db")

INITIAL_DRONES = [
    {
        "call_sign":      "GW-RECCO-01",
        "type":           "reconnaissance",
        "model":          "Scout Pro X1",
        "autonomy_min":   45,
        "area_mojado_m2": 0,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-01",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-02",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-03",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "maintenance",
    },
    {
        "call_sign":      "GW-CISTERNA-04",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-05",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-06",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-07",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
    {
        "call_sign":      "GW-CISTERNA-08",
        "type":           "tanker",
        "model":          "Tanker Alpha 2200",
        "autonomy_min":   30,
        "area_mojado_m2": 500,
        "status":         "available",
    },
]


async def seed_fleet(db) -> None:
    """
    Inserta la flota inicial si la coleccion 'drones' esta vacia.
    Si ya hay drones, parchea los que no tengan los campos nuevos (model/autonomy_min/area_mojado_m2).
    """
    count = await db["drones"].count_documents({})
    if count == 0:
        now = datetime.now(timezone.utc)
        docs = [
            {**d, "flight_hours": 0.0, "last_mission_id": None, "notes": "", "created_at": now}
            for d in INITIAL_DRONES
        ]
        result = await db["drones"].insert_many(docs)
        log.info("[DB] Flota inicializada: %d drones insertados", len(result.inserted_ids))
        return

    # Parche: añadir campos nuevos a drones existentes que no los tengan
    patched = 0
    seed_map = {d["call_sign"]: d for d in INITIAL_DRONES}
    cursor = db["drones"].find({"model": {"$exists": False}})
    async for drone in cursor:
        cs = drone.get("call_sign", "")
        defaults = seed_map.get(cs, INITIAL_DRONES[1])  # fallback tanker
        await db["drones"].update_one(
            {"_id": drone["_id"]},
            {"$set": {
                "model":          defaults["model"],
                "autonomy_min":   defaults["autonomy_min"],
                "area_mojado_m2": defaults["area_mojado_m2"],
            }},
        )
        patched += 1

    if patched:
        log.info("[DB] Parcheados %d drones con campos nuevos (model/autonomy/area)", patched)
    else:
        log.info("[DB] Flota ya inicializada (%d drones)", count)
