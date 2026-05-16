"""
Galicia Wildfire — Backend FastAPI
Arquitectura Docker sin WSL:
  mavlink-bridge (Docker) → UDP:14550 → este backend → WebSocket → frontend
  simulador-gw   (Docker) → física del dron → MongoDB → mavlink-bridge
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient

from config import settings
from api.routes.health     import router as health_router
from api.routes.game       import router as game_router
from api.routes.simulation import router as simulation_router
from api.routes.fleet      import router as fleet_router
from api.websockets.telemetry_ws import telemetry_manager, telemetry_ws_endpoint
from api.websockets.control_ws   import control_ws_endpoint
from mavlink.connection  import MAVLinkManager
from mavlink.commands    import CommandSender
from mavlink.mission     import MissionManager
from simulation.sitl_manager import SITLManager
from game.fire_spread import FireManager
from game.swarm import SwarmManager
from db.mongo_init import seed_fleet

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s — %(message)s",
    datefmt="%H:%M:%S",
)
logging.getLogger("gw.sitl").setLevel(logging.DEBUG)
logging.getLogger("gw.mavlink").setLevel(logging.DEBUG)
logging.getLogger("gw.routes.simulation").setLevel(logging.DEBUG)
log = logging.getLogger("gw.main")


async def _queue_broadcaster(name: str, queue: asyncio.Queue) -> None:
    log.info("[GW] Broadcaster '%s' iniciado", name)
    while True:
        try:
            payload: dict = await queue.get()
            await telemetry_manager._broadcast_one(json.dumps(payload))
        except asyncio.CancelledError:
            break
        except Exception as exc:
            log.error("[GW] Error broadcaster '%s': %s", name, exc)
            await asyncio.sleep(0.5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("[GW] Galicia Wildfire backend iniciando...")

    # ── MongoDB ────────────────────────────────────────────────────────────────
    mongo_client = AsyncIOMotorClient(settings.MONGODB_URI)
    db = mongo_client["galicia_wildfire"]
    app.state.db           = db
    app.state.mongo_client = mongo_client
    try:
        await seed_fleet(db)
    except Exception as exc:
        log.warning("[GW] MongoDB no disponible: %s", exc)

    # ── Componentes ────────────────────────────────────────────────────────────
    mav           = MAVLinkManager(host=settings.MAVLINK_HOST, port=settings.MAVLINK_PORT)
    cmds          = CommandSender(mav)
    mission       = MissionManager(mav)
    sitl          = SITLManager(mode=settings.SITL_MODE)
    fire_manager  = FireManager()
    swarm_manager = SwarmManager()

    app.state.mavlink       = mav
    app.state.cmds          = cmds
    app.state.mission       = mission
    app.state.sitl          = sitl
    app.state.fire_manager  = fire_manager
    app.state.swarm_manager = swarm_manager

    # ── MAVLink — loop permanente en background (conecta cuando SITL esté listo) ──
    mavlink_task = asyncio.create_task(mav.start_loop(), name="mavlink-loop")
    log.info("[GW] MAVLink loop iniciado (mock hasta que ArduCopter responda)")

    # ── Broadcasters ──────────────────────────────────────────────────────────
    broadcaster_task      = telemetry_manager.start_broadcaster(mav)
    fire_broadcaster_task = asyncio.create_task(
        _queue_broadcaster("fire", fire_manager.queue), name="fire-broadcaster"
    )
    swarm_broadcaster_task = asyncio.create_task(
        _queue_broadcaster("swarm", swarm_manager.queue), name="swarm-broadcaster"
    )
    log.info("[GW] Broadcasters WebSocket activos")

    yield

    # ── Shutdown ───────────────────────────────────────────────────────────────
    log.info("[GW] Backend cerrando...")
    for t in (mavlink_task, broadcaster_task, fire_broadcaster_task, swarm_broadcaster_task):
        if not t.done():
            t.cancel()
    fire_manager.stop()
    swarm_manager.stop()
    await mav.close()
    if settings.SITL_MODE == "managed":
        await sitl.stop()
    mongo_client.close()
    log.info("[GW] Cerrando. Hasta luego.")


app = FastAPI(
    title="Galicia Wildfire",
    description="Sistema de extinción autónoma con drones UAV — Arquitectura Docker",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(game_router)
app.include_router(simulation_router)
app.include_router(fleet_router)


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await telemetry_ws_endpoint(ws, app.state.mavlink)


@app.websocket("/ws/control")
async def ws_control(ws: WebSocket):
    await control_ws_endpoint(
        ws,
        app.state.mavlink,
        app.state.cmds,
        app.state.mission,
        app.state.db,
    )
