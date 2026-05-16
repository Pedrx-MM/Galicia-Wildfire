'use strict';
/**
 * Galicia Wildfire — Swarm Renderer (Fase 8)
 * Spec §10 — Renderiza los drones del enjambre sobre el mapa MapLibre.
 *
 * Capas MapLibre gestionadas:
 *   swarm-routes-layer  → líneas de pasada (blanco punteado)
 *   swarm-drones-layer  → círculos de posición de cada dron
 *   water-drop-layer    → efecto de descarga de agua (círculos azules fugaces)
 *
 * Recibe swarm_update { drones:[{id, lat, lon, heading, status, water, wp_idx}] }
 * y actualiza las fuentes GeoJSON. La interpolación entre updates la hace CSS
 * via transition en el circulo (no se anima posición en MapLibre GL JS directamente).
 */

class SwarmRenderer {
  /**
   * @param {maplibregl.Map} map
   * @param {object} callbacks
   *   onProgress(extinguishedPct)  — porcentaje total de celdas extinguidas
   *   onMissionComplete()          — todos los drones terminaron
   */
  constructor(map, { onProgress, onMissionComplete } = {}) {
    this._map       = map;
    this._onProg    = onProgress       ?? (() => {});
    this._onDone    = onMissionComplete ?? (() => {});

    this._routes     = [];          // [{id, route:[{lat,lon}]}]
    this._droneData  = {};          // id → snapshot
    this._dropTimers = [];          // setTimeout IDs para limpiar drops
    this._active     = false;

    this._initLayers();
  }

  // ─── API pública ────────────────────────────────────────────────────────────

  /** Llama al lanzar el enjambre. Recibe la respuesta de /api/game/launch-swarm. */
  initSwarm(swarmData) {
    this._routes  = swarmData.drones.map(d => ({ id: d.id, route: d.route }));
    this._active  = true;
    this._renderRoutes();
  }

  /** Llama al recibir swarm_update por WebSocket. */
  update(msg) {
    if (!this._active) return;

    const drones = msg.drones ?? [];
    drones.forEach(d => {
      const prev = this._droneData[d.id];
      // Si el dron estaba flying y ahora está descargando agua → efecto visual
      if (prev && prev.status === 'flying' && d.status === 'flying') {
        if (d.water < prev.water - 0.5) {
          this._spawnWaterDrop(d.lat, d.lon);
        }
      }
      this._droneData[d.id] = d;
    });

    this._renderDrones(drones);

    if (msg.mission_complete) {
      this._onDone();
    }
  }

  /** Limpia todas las capas (al resetear la geofence o reiniciar). */
  clear() {
    this._active    = false;
    this._routes    = [];
    this._droneData = {};
    this._dropTimers.forEach(t => clearTimeout(t));
    this._dropTimers = [];
    const empty = { type: 'FeatureCollection', features: [] };
    ['swarm-routes-src', 'swarm-drones-src', 'water-drop-src'].forEach(id => {
      this._map.getSource(id)?.setData(empty);
    });
  }

  // ─── Capas MapLibre ─────────────────────────────────────────────────────────

  _initLayers() {
    const empty = { type: 'FeatureCollection', features: [] };

    this._map.addSource('swarm-routes-src', { type: 'geojson', data: empty });
    this._map.addSource('swarm-drones-src', { type: 'geojson', data: empty });
    this._map.addSource('water-drop-src',   { type: 'geojson', data: empty });

    // Rutas de pasada (líneas blancas punteadas)
    this._map.addLayer({
      id: 'swarm-routes-layer', type: 'line', source: 'swarm-routes-src',
      paint: {
        'line-color':     '#ffffff',
        'line-width':     1.2,
        'line-opacity':   0.45,
        'line-dasharray': [6, 5],
      },
    });

    // Posición de los drones cisterna (círculo azul agua con borde blanco)
    this._map.addLayer({
      id: 'swarm-drones-layer', type: 'circle', source: 'swarm-drones-src',
      paint: {
        'circle-radius':       7,
        'circle-color':        ['match', ['get', 'status'],
          'flying',    '#3bb8e0',
          'rtb',       '#f2a623',
          'reloading', '#e85d24',
          'done',      '#444444',
          '#3bb8e0',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity':      0.95,
      },
    });

    // Efecto agua — gotas cian que se desvanecen
    this._map.addLayer({
      id: 'water-drop-layer', type: 'circle', source: 'water-drop-src',
      paint: {
        'circle-radius':  ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 55],
        'circle-color':   '#3bb8e0',
        'circle-opacity': 0.35,
        'circle-blur':    0.6,
      },
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  _renderRoutes() {
    const features = this._routes.map(({ id, route }) => {
      const coords = route.map(p => [p.lon, p.lat]);
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: { drone_id: id },
      };
    });
    this._map.getSource('swarm-routes-src')?.setData({
      type: 'FeatureCollection', features,
    });
  }

  _renderDrones(drones) {
    const features = drones.map(d => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
      properties: { id: d.id, status: d.status, water: d.water },
    }));
    this._map.getSource('swarm-drones-src')?.setData({
      type: 'FeatureCollection', features,
    });
  }

  _spawnWaterDrop(lat, lon) {
    const src = this._map.getSource('water-drop-src');
    if (!src) return;

    // Añadir la gota
    const current = src._data ?? { type: 'FeatureCollection', features: [] };
    const drop = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: { ts: Date.now() },
    };
    const updated = {
      type: 'FeatureCollection',
      features: [...(current.features ?? []), drop],
    };
    src.setData(updated);

    // Eliminarla tras 1.8s
    const t = setTimeout(() => {
      const s = this._map.getSource('water-drop-src');
      if (!s) return;
      const d = s._data;
      if (!d) return;
      s.setData({
        type: 'FeatureCollection',
        features: (d.features ?? []).filter(f => f.properties.ts !== drop.properties.ts),
      });
    }, 1800);
    this._dropTimers.push(t);

    // Limpiar timers completados
    if (this._dropTimers.length > 50) {
      this._dropTimers = this._dropTimers.slice(-30);
    }
  }
}

window.SwarmRenderer = SwarmRenderer;
