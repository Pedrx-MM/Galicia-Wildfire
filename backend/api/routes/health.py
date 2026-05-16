"""
GET /health — Estado del sistema: MAVLink, SITL, versión.
"""
from fastapi import APIRouter, Request
from datetime import datetime, timezone

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(request: Request):
    mav  = getattr(request.app.state, "mavlink", None)
    sitl = getattr(request.app.state, "sitl", None)

    mavlink_connected = mav.connected if mav else False
    sitl_running      = False
    if sitl:
        try:
            sitl_running = await sitl.poll_running()
        except Exception:
            sitl_running = False

    return {
        "status":           "ok",
        "timestamp":        datetime.now(timezone.utc).isoformat(),
        "mavlink_connected": mavlink_connected,
        "mavlink_mock":     mav.use_mock if mav else True,
        "sitl_running":     sitl_running,
        "version":          "1.0.0",
    }
