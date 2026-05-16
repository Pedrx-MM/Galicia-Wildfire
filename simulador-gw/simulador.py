"""
Simulador GW — tick cada TICK_SEGUNDOS (por defecto 1).

Lee de MongoDB:
  sim_drones   → estado actual del dron simulado
  sim_misiones → misión activa con waypoints

Escribe de vuelta en MongoDB los cambios de posición/estado.
El mavlink-bridge lee sim_drones y genera paquetes UDP MAVLink.
"""

import os
import time
import math
import logging
from datetime import datetime, timezone

from pymongo import MongoClient, DESCENDING
from bson import ObjectId
from bson.errors import InvalidId

MONGO_URI     = os.environ.get("MONGO_URI", "mongodb://gw_admin:gw_pass@mongodb:27017/")
DB_NAME       = os.environ.get("DB_NAME", "galicia_wildfire")
TICK_SEGUNDOS = float(os.environ.get("TICK_SEGUNDOS", "1"))
SIM_DRONE_ID  = os.environ.get("SIM_DRONE_ID", "gw-sim-01")

MAX_TRAIL     = 500
LLEGADA_M     = 5.0
BATERIA_CRIT  = 10.0
VELOCIDAD_ASC = 5.0

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [simulador-gw] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc)


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def mover_hacia(lat, lon, lat_dest, lon_dest, distancia_m):
    d_total = haversine_m(lat, lon, lat_dest, lon_dest)
    if d_total < 0.01:
        return lat_dest, lon_dest
    ratio = min(distancia_m / d_total, 1.0)
    return lat + (lat_dest - lat) * ratio, lon + (lon_dest - lon) * ratio


def consumo_por_tick(drone, tick_s):
    consumo_w      = float(drone.get("consumo_w", 50.0))
    bateria_max_wh = float(drone.get("bateria_max_wh", 40.0))
    if bateria_max_wh <= 0:
        return 0.0
    return (consumo_w / bateria_max_wh) * (tick_s / 3600) * 100


def procesar_tick(db):
    col_drones   = db["sim_drones"]
    col_misiones = db["sim_misiones"]

    drone = col_drones.find_one({"_id": SIM_DRONE_ID})
    if not drone:
        log.debug("Sin sim_drone en MongoDB")
        return

    # Buscar misión activa
    mision = col_misiones.find_one(
        {"drone_id": SIM_DRONE_ID, "estado": "activa"},
        sort=[("creada_en", DESCENDING)],
    )

    estado    = drone.get("estado", "en_tierra")
    pos       = drone.get("posicion", {"lat": 42.60, "lon": -7.05, "alt_m": 0.0})
    bateria   = float(drone.get("bateria_pct", 100.0))
    modo      = drone.get("modo", "loiter")
    waypoints = mision.get("waypoints", []) if mision else []
    wp_idx    = int(mision.get("waypoint_actual", 0)) if mision else 0

    log.info(
        "[tick] estado=%s modo=%s pos=(%.5f,%.5f,%.1fm) bat=%.1f%% wp=%d/%d mision=%s",
        estado, modo, pos["lat"], pos["lon"], pos.get("alt_m", 0),
        bateria, wp_idx, len(waypoints),
        mision["_id"] if mision else "ninguna",
    )

    if estado != "en_tierra":
        descuento = consumo_por_tick(drone, TICK_SEGUNDOS)
        bateria   = max(0.0, bateria - descuento)

    upd_d = {"bateria_pct": bateria, "actualizado_en": now()}
    upd_m = {}

    # Emergencia por batería
    if bateria <= BATERIA_CRIT and estado not in ("en_tierra", "aterrizando"):
        log.warning("⚠ Batería crítica (%.1f%%) — aterrizaje de emergencia", bateria)
        upd_d["estado"] = "aterrizando"
        if mision:
            col_misiones.update_one(
                {"_id": mision["_id"]},
                {"$set": {"estado": "abortada", "finalizada_en": now(),
                          "motivo_fin": "bateria_critica"}},
            )
        col_drones.update_one({"_id": SIM_DRONE_ID}, {"$set": upd_d})
        return

    # ── Máquina de estados ────────────────────────────────────────────────────

    if estado == "despegando":
        if not waypoints:
            log.warning("Despegando sin waypoints — cancelando")
            upd_d["estado"] = "en_tierra"
        else:
            wp_crucero = next(
                (w for w in waypoints if w.get("tipo") != "despegue"),
                waypoints[0],
            )
            alt_objetivo = max(float(wp_crucero.get("alt_m", 30.0)), 30.0)
            alt_actual   = float(pos.get("alt_m", 0.0))
            nueva_alt    = min(alt_actual + VELOCIDAD_ASC * TICK_SEGUNDOS, alt_objetivo)
            upd_d["posicion"] = {**pos, "alt_m": nueva_alt}
            log.info("Despegando: %.1fm → %.1fm (objetivo %.1fm)", alt_actual, nueva_alt, alt_objetivo)
            if nueva_alt >= alt_objetivo:
                log.info("✅ Despegue completado → volando")
                upd_d["estado"] = "volando"
                upd_d["modo"]   = "auto"
                if waypoints and waypoints[0].get("tipo") == "despegue":
                    wp_idx = 1
                    upd_m["waypoint_actual"] = wp_idx

    elif estado == "volando" and modo == "loiter":
        log.info("Loiter — manteniendo posición")

    elif estado == "volando" and modo == "rtl":
        rtl_target = drone.get("rtl_target")
        if not rtl_target and waypoints:
            dep = next((w for w in waypoints if w.get("tipo") == "despegue"), waypoints[0])
            rtl_target = {"lat": float(dep["lat"]), "lon": float(dep["lon"])}
        if not rtl_target:
            upd_d["estado"] = "aterrizando"
        else:
            lat_dest  = float(rtl_target["lat"])
            lon_dest  = float(rtl_target["lon"])
            vel       = float(drone.get("velocidad_max_ms", 15.0))
            distancia = haversine_m(pos["lat"], pos["lon"], lat_dest, lon_dest)
            log.info("RTL → (%.5f,%.5f) dist=%.1fm", lat_dest, lon_dest, distancia)
            if distancia <= LLEGADA_M:
                log.info("RTL completado → aterrizando")
                upd_d["estado"] = "aterrizando"
            else:
                lat_n, lon_n = mover_hacia(pos["lat"], pos["lon"], lat_dest, lon_dest,
                                           vel * TICK_SEGUNDOS)
                upd_d["posicion"] = {"lat": lat_n, "lon": lon_n, "alt_m": float(pos.get("alt_m", 0))}

    elif estado == "volando" and modo == "auto":
        if not mision or wp_idx >= len(waypoints):
            log.info("Sin más waypoints → aterrizando")
            upd_d["estado"] = "aterrizando"
        else:
            wp        = waypoints[wp_idx]
            es_aterrizaje = wp.get("tipo") == "aterrizaje"
            lat_dest  = float(wp["lat"])
            lon_dest  = float(wp["lon"])
            alt_dest  = float(pos.get("alt_m", 0)) if es_aterrizaje else float(wp.get("alt_m", 120))
            vel       = float(drone.get("velocidad_max_ms", 15.0))
            distancia = haversine_m(pos["lat"], pos["lon"], lat_dest, lon_dest)
            log.info("Volando → WP%d (%.5f,%.5f) dist=%.1fm%s",
                     wp_idx, lat_dest, lon_dest, distancia,
                     " [ATERRIZAJE]" if es_aterrizaje else "")

            if distancia <= LLEGADA_M:
                log.info("✅ WP%d alcanzado", wp_idx)
                wp_idx += 1
                upd_m["waypoint_actual"] = wp_idx
                if wp_idx >= len(waypoints) or es_aterrizaje:
                    log.info("✅ Último waypoint → aterrizando")
                    upd_d["estado"] = "aterrizando"
                else:
                    upd_d["posicion"] = {"lat": lat_dest, "lon": lon_dest, "alt_m": float(pos.get("alt_m", 0))}
            else:
                lat_n, lon_n = mover_hacia(pos["lat"], pos["lon"], lat_dest, lon_dest,
                                           vel * TICK_SEGUNDOS)
                if es_aterrizaje:
                    alt_n = float(pos.get("alt_m", 0))
                else:
                    dist_nueva = haversine_m(lat_n, lon_n, lat_dest, lon_dest)
                    progreso   = 1.0 - min(dist_nueva / max(distancia, 0.01), 1.0)
                    alt_n      = float(pos.get("alt_m", 0)) + (alt_dest - float(pos.get("alt_m", 0))) * progreso
                nueva_pos = {"lat": lat_n, "lon": lon_n, "alt_m": alt_n}
                upd_d["posicion"] = nueva_pos

                # Trail de la ruta
                if mision:
                    col_misiones.update_one(
                        {"_id": mision["_id"]},
                        {"$push": {
                            "ruta_recorrida": {
                                "$each":  [{"lat": lat_n, "lon": lon_n, "alt_m": alt_n,
                                            "ts": now().isoformat(), "bat": bateria}],
                                "$slice": -MAX_TRAIL,
                            }
                        }},
                    )

    elif estado == "volando" and modo in ("land", "emergency"):
        log.info("Modo %s → aterrizando", modo)
        upd_d["estado"] = "aterrizando"

    elif estado == "aterrizando":
        alt_actual = float(pos.get("alt_m", 0.0))
        nueva_alt  = max(0.0, alt_actual - VELOCIDAD_ASC * TICK_SEGUNDOS)
        upd_d["posicion"] = {**pos, "alt_m": nueva_alt}
        log.info("Aterrizando: %.1fm → %.1fm", alt_actual, nueva_alt)
        if nueva_alt <= 0.0:
            log.info("✅ Aterrizaje completado → en_tierra")
            upd_d["estado"] = "en_tierra"
            upd_d["armado"] = False
            if mision:
                col_misiones.update_one(
                    {"_id": mision["_id"], "estado": "activa"},
                    {"$set": {"estado": "completada", "finalizada_en": now()}},
                )

    elif estado == "en_tierra":
        # Limpiar misiones activas residuales (reinicio del simulador)
        pass

    # Persistir
    col_drones.update_one({"_id": SIM_DRONE_ID}, {"$set": upd_d})
    if upd_m and mision:
        col_misiones.update_one({"_id": mision["_id"]}, {"$set": upd_m})


def main():
    log.info("Simulador GW — tick=%.1fs. Conectando a MongoDB...", TICK_SEGUNDOS)

    for intento in range(30):
        try:
            mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            mongo.admin.command("ping")
            log.info("✅ MongoDB conectado")
            break
        except Exception as e:
            log.warning("Intento %d/30: %s", intento + 1, e)
            time.sleep(2)
    else:
        log.error("No se pudo conectar a MongoDB tras 30 intentos. Saliendo.")
        raise SystemExit(1)

    db = mongo[DB_NAME]

    # Limpiar misiones activas residuales del arranque anterior
    residuales = list(db["sim_misiones"].find({"estado": "activa"}))
    if residuales:
        log.warning("⚠ %d misión(es) activa(s) residual(es) — abortando", len(residuales))
        for m in residuales:
            db["sim_misiones"].update_one(
                {"_id": m["_id"]},
                {"$set": {"estado": "abortada", "finalizada_en": now(),
                          "motivo_fin": "simulador_reiniciado"}},
            )
        db["sim_drones"].update_one(
            {"_id": SIM_DRONE_ID},
            {"$set": {"estado": "en_tierra", "armado": False, "actualizado_en": now()}},
        )
        log.info("✅ Misiones residuales abortadas")

    log.info("Bucle de simulación iniciado.")
    while True:
        t0 = time.monotonic()
        try:
            procesar_tick(db)
        except Exception as e:
            log.error("Error en tick: %s", e, exc_info=True)
        elapsed = time.monotonic() - t0
        time.sleep(max(0.0, TICK_SEGUNDOS - elapsed))


if __name__ == "__main__":
    main()
