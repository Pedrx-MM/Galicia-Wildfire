"""
Configuración global de Galicia Wildfire.
"""
import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    MAVLINK_HOST: str = os.getenv("MAVLINK_HOST", "0.0.0.0")
    MAVLINK_PORT: int = int(os.getenv("MAVLINK_PORT", "14550"))
    SITL_MODE: str    = os.getenv("SITL_MODE", "external")   # external = mavlink-bridge Docker

    # ID fijo del dron simulado en MongoDB (sim_drones collection)
    SIM_DRONE_ID: str = os.getenv("SIM_DRONE_ID", "gw-sim-01")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    MONGODB_URI: str  = os.getenv(
        "MONGODB_URI",
        "mongodb://gw_admin:gw_pass@localhost:27018/galicia_wildfire?authSource=admin",
    )

    ZONES = {
        "courel": {"name": "Serra do Courel", "center": [-7.05, 42.60], "zoom": 13},
        "eume":   {"name": "Fragas do Eume",  "center": [-8.05, 43.40], "zoom": 13},
        "suido":  {"name": "Serra do Suido",  "center": [-8.27, 42.37], "zoom": 13},
        "pindo":  {"name": "Monte Pindo",     "center": [-9.07, 42.84], "zoom": 13},
    }


settings = Settings()
