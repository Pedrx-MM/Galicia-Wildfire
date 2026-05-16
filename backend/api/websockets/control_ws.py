"""
Galicia Wildfire — WebSocket /ws/control
Protocolo: { "action": "<action>", ...params }

Cada comando:
  1. Escribe en MongoDB sim_drones / sim_misiones (el simulador-gw lo ejecuta)
  2. También envía el comando MAVLink real (para compatibilidad y confirmación)
     El mavlink-bridge genera el HEARTBEAT confirmando el nuevo estado.
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect

from config import settings

log = logging.getLogger("gw.ws.control")

SIM_DRONE_ID = settings.SIM_DRONE_ID


def now():
    return datetime.now(timezone.utc)


# Mapa de modo frontend → modo simulador-gw
_MODE_MAP = {
    "STABILIZE": "loiter",
    "ALT_HOLD":  "loiter",
    "LOITER":    "loiter",
    "GUIDED":    "loiter",
    "AUTO":      "auto",
    "RTL":       "rtl",
    "LAND":      "land",
}


async def _sim_update(db, update: dict):
    """Actualiza sim_drones en MongoDB si db está disponible."""
    if db is None:
        return
    try:
        update["actualizado_en"] = now()
        await db["sim_drones"].update_one(
            {"_id": SIM_DRONE_ID},
            {"$set": update},
        )
    except Exception as exc:
        log.warning("[WS/ctl] sim_update error: %s", exc)


async def _sim_start_mission(db):
    """Activa la misión planificada en sim_misiones."""
    if db is None:
        return False
    try:
        result = await db["sim_misiones"].update_one(
            {"drone_id": SIM_DRONE_ID, "estado": "planificada"},
            {"$set": {"estado": "activa", "iniciada_en": now(),
                      "waypoint_actual": 0, "ruta_recorrida": []}},
        )
        return result.modified_count > 0
    except Exception as exc:
        log.warning("[WS/ctl] sim_start_mission error: %s", exc)
        return False


async def control_ws_endpoint(ws: WebSocket, mav, cmds, mission_mgr=None, db=None):
    await ws.accept()
    log.info("[WS/ctl] Control conectado")

    async def reply(ok: bool, msg: str = "", **extra):
        await ws.send_text(json.dumps({"ok": ok, "msg": msg, **extra}))

    try:
        while True:
            raw = await ws.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await reply(False, "JSON inválido")
                continue

            action = data.get("action", "")
            log.debug("[WS/ctl] action=%s", action)

            if action == "arm":
                # 1. Escribir en MongoDB para que el simulador lo recoja
                await _sim_update(db, {"armado": True})
                # 2. Enviar MAVLink (el bridge lo confirmará via HEARTBEAT)
                ok = await cmds.arm(force=data.get("force", False))
                await reply(ok, "Armado" if ok else "ARM fallido o no confirmado")

            elif action == "disarm":
                await _sim_update(db, {"armado": False})
                ok = await cmds.disarm(force=data.get("force", False))
                await reply(ok, "Desarmado" if ok else "DISARM fallido")

            elif action == "set_mode":
                mode = data.get("mode", "").upper()
                sim_modo = _MODE_MAP.get(mode, "loiter")
                await _sim_update(db, {"modo": sim_modo})
                ok = await cmds.set_mode(mode)
                await reply(ok, f"Modo {mode}" if ok else f"Modo desconocido: {mode}")

            elif action == "takeoff":
                alt = float(data.get("alt", 30))
                # Armar + iniciar despegue
                await _sim_update(db, {
                    "armado":  True,
                    "estado":  "despegando",
                })
                await cmds.takeoff(alt_m=alt)
                await reply(True, f"Despegue → {alt} m AGL")

            elif action == "land":
                await _sim_update(db, {"modo": "land", "estado": "aterrizando"})
                await cmds.land()
                await reply(True, "LAND activado")

            elif action == "rtl":
                await _sim_update(db, {"modo": "rtl"})
                await cmds.rtl()
                await reply(True, "RTL activado")

            elif action == "rc_override":
                ch = data.get("channels", {})
                await cmds.rc_override(
                    roll=int(ch.get("roll", 1500)),
                    pitch=int(ch.get("pitch", 1500)),
                    throttle=int(ch.get("throttle", 1500)),
                    yaw=int(ch.get("yaw", 1500)),
                )

            elif action == "start_mission":
                # 1. Armar + poner en despegue en MongoDB
                await _sim_update(db, {
                    "armado": True,
                    "estado": "despegando",
                    "modo":   "auto",
                })
                # 2. Activar la misión planificada
                mision_ok = await _sim_start_mission(db)
                # 3. Enviar MAVLink (el ARM se confirmará via HEARTBEAT del bridge)
                ok = await cmds.start_mission()
                await reply(
                    ok or mision_ok,
                    "Misión AUTO iniciada" if (ok or mision_ok) else "Error al iniciar misión",
                )

            elif action == "fence_enable":
                await cmds.fence_enable()
                await reply(True, "Geofence activada")

            elif action == "fence_disable":
                await cmds.fence_disable()
                await reply(True, "Geofence desactivada")

            elif action == "set_home":
                await cmds.set_home(
                    float(data.get("lat", 0)),
                    float(data.get("lon", 0)),
                    float(data.get("alt", 0)),
                )
                await reply(True)

            elif action == "clear_mission":
                if mission_mgr:
                    ok = await mission_mgr.clear_mission()
                    await reply(ok, "Misión borrada" if ok else "Error")
                else:
                    await reply(False, "MissionManager no disponible")

            else:
                await reply(False, f"Acción desconocida: {action}")

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.error("[WS/ctl] Error: %s", exc)
    finally:
        log.info("[WS/ctl] Control desconectado")
