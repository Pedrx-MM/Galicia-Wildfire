/**
 * Configuración global del frontend.
 * Se carga desde index.html antes que cualquier otro script.
 * NO contiene lógica — solo constantes configurables.
 */
window.APP_CONFIG = {
  API_URL:        `http://${window.location.hostname}:8000`,
  // WS_TELEMETRY → FastAPI (telemetría + fire_update + swarm_update)
  WS_TELEMETRY:   `ws://${window.location.hostname}:8000/ws/telemetry`,
  // WS_CONTROL → FastAPI (ARM, modos, comandos discretos, RC override)
  WS_CONTROL:     `ws://${window.location.hostname}:8000/ws/control`,

  // MapTiler terrain-rgb (requiere API key gratuita en maptiler.com)
  TERRAIN_TILE_URL: 'https://api.maptiler.com/tiles/terrain-rgb/{z}/{x}/{y}.png?key=YOUR_MAPTILER_KEY',

  // PNOA ortofoto IGN España (WMS gratuito, 25 cm resolución)
  PNOA_WMS_URL: 'https://www.ign.es/wms-inspire/pnoa-ma',

  // OpenFreeMap estilo base (gratuito, sin token)
  OPENFREEMAP_STYLE: 'https://tiles.openfreemap.com/styles/liberty',
};
