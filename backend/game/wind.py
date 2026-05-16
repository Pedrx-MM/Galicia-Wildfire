"""
Generación aleatoria de condiciones de viento para la misión.
El viento se genera una vez al iniciar la misión y no cambia.
"""
import random


def generate_wind() -> dict:
    """
    Devuelve dirección (0° = norte, sentido horario) y velocidad en km/h.
    Convención meteorológica: direction_deg = procedencia del viento.
    """
    return {
        "direction_deg": round(random.uniform(0, 360), 1),
        "speed_kmh":     round(random.uniform(8, 55), 1),
    }
