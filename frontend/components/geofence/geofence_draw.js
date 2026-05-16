'use strict';
/**
 * Galicia Wildfire — Geofence Draw (Fase 7)
 * Spec §9 — Captura vértices en la posición GPS actual del dron.
 *
 * Estados: INACTIVE → RECORDING → CLOSED
 * R1 (button[5]) → addVertex() / startRecording()
 * L1 (button[4]) → closeGeofence()
 *
 * Requiere que el mapa MapLibre esté completamente cargado antes de instanciar.
 */

class GeofenceDraw {
  /**
   * @param {maplibregl.Map} map
   * @param {object} callbacks
   *   onStart(n)         — empieza grabación (n = nº de geofences cerradas hasta ahora)
   *   onVertex(n)        — nuevo vértice añadido, n = total
   *   onClosed(polygon, areaHa) — polígono cerrado, listo para lanzar enjambre
   *   onReset()          — geofence descartada / reiniciada
   *   onError(msg)       — validación fallida (ej. <3 vértices)
   */
  constructor(map, { onStart, onVertex, onClosed, onReset, onError } = {}) {
    this._map      = map;
    this._onStart  = onStart  ?? (() => {});
    this._onVertex = onVertex ?? (() => {});
    this._onClosed = onClosed ?? (() => {});
    this._onReset  = onReset  ?? (() => {});
    this._onError  = onError  ?? (() => {});

    this.state    = 'INACTIVE';   // 'INACTIVE' | 'RECORDING' | 'CLOSED'
    this.vertices = [];            // [{lat, lon}, ...]
    this._dronePos = null;         // última posición del dron
    this._closedCount = 0;         // cuántas geofences se han cerrado

    this._initLayers();
  }

  // ─── API pública ────────────────────────────────────────────────────────────

  /** Notifica la posición actual del dron (llamar en cada telemetría). */
  updateDronePos(lat, lon) {
    this._dronePos = { lat, lon };
  }

  /**
   * R1: añade un vértice en la posición actual del dron.
   * Si el estado es INACTIVE, inicia la grabación automáticamente.
   */
  addVertex() {
    if (!this._dronePos) {
      this._onError('Sin posición GPS del dron');
      return false;
    }

    if (this.state === 'CLOSED') {
      this._onError('Cierra o reinicia la geofence actual primero');
      return false;
    }

    if (this.state === 'INACTIVE') {
      this.state    = 'RECORDING';
      this.vertices = [];
      this._onStart(this._closedCount);
    }

    if (this.vertices.length >= 20) {
      this._onError('Máximo 20 vértices por geofence');
      return false;
    }

    this.vertices.push({ lat: this._dronePos.lat, lon: this._dronePos.lon });
    this._updatePreview();
    this._onVertex(this.vertices.length);
    return true;
  }

  /**
   * L1: cierra el polígono.
   * Requiere ≥3 vértices. Devuelve el GeoJSON Polygon o null.
   */
  closeGeofence() {
    if (this.state !== 'RECORDING') return null;

    if (this.vertices.length < 3) {
      this._onError(`Mínimo 3 vértices (tienes ${this.vertices.length})`);
      return null;
    }

    this.state = 'CLOSED';
    this._closedCount++;

    const polygon = this._buildPolygon();
    const areaHa  = this._calcAreaHa();
    this._renderClosed(polygon);
    this._onClosed(polygon, areaHa);
    return polygon;
  }

  /** Descarta la geofence en curso y vuelve a INACTIVE. */
  reset() {
    this.state    = 'INACTIVE';
    this.vertices = [];
    this._clearLayers();
    this._onReset();
  }

  // ─── Capas MapLibre ─────────────────────────────────────────────────────────

  _initLayers() {
    const empty = () => ({ type: 'FeatureCollection', features: [] });

    // Fuentes GeoJSON
    this._map.addSource('geofence-preview-src', { type: 'geojson', data: empty() });
    this._map.addSource('geofence-vertex-src',  { type: 'geojson', data: empty() });
    this._map.addSource('geofence-closed-src',  { type: 'geojson', data: empty() });

    // Línea de preview (cyan punteado) — durante RECORDING
    this._map.addLayer({
      id: 'geofence-preview-line', type: 'line', source: 'geofence-preview-src',
      paint: {
        'line-color':     '#00bfff',
        'line-width':     2,
        'line-dasharray': [5, 4],
        'line-opacity':   0.85,
      },
    });

    // Puntos de vértice (círculos blancos con borde cyan)
    this._map.addLayer({
      id: 'geofence-vertex-dots', type: 'circle', source: 'geofence-vertex-src',
      paint: {
        'circle-radius':       5,
        'circle-color':        '#ffffff',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#00bfff',
        'circle-opacity':      0.9,
      },
    });

    // Relleno del polígono cerrado (azul translúcido)
    this._map.addLayer({
      id: 'geofence-closed-fill', type: 'fill', source: 'geofence-closed-src',
      paint: {
        'fill-color':   '#00bfff',
        'fill-opacity': 0.15,
      },
    });

    // Borde del polígono cerrado (cyan sólido)
    this._map.addLayer({
      id: 'geofence-closed-line', type: 'line', source: 'geofence-closed-src',
      paint: {
        'line-color':   '#00bfff',
        'line-width':   2.5,
        'line-opacity': 0.92,
      },
    });
  }

  _updatePreview() {
    if (this.vertices.length === 0) return;
    const coords = this.vertices.map(v => [v.lon, v.lat]);

    this._map.getSource('geofence-preview-src').setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
        properties: {},
      }],
    });

    this._map.getSource('geofence-vertex-src').setData({
      type: 'FeatureCollection',
      features: coords.map(c => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: c },
        properties: {},
      })),
    });
  }

  _renderClosed(polygon) {
    // Ocultar preview
    const empty = { type: 'FeatureCollection', features: [] };
    this._map.getSource('geofence-preview-src').setData(empty);

    // Mostrar polígono cerrado
    this._map.getSource('geofence-closed-src').setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: polygon, properties: {} }],
    });
  }

  _clearLayers() {
    const empty = { type: 'FeatureCollection', features: [] };
    ['geofence-preview-src', 'geofence-vertex-src', 'geofence-closed-src']
      .forEach(id => this._map.getSource(id)?.setData(empty));
  }

  // ─── Geometría ──────────────────────────────────────────────────────────────

  _buildPolygon() {
    const ring = this.vertices.map(v => [v.lon, v.lat]);
    ring.push(ring[0]);   // cerrar anillo
    return { type: 'Polygon', coordinates: [ring] };
  }

  _calcAreaHa() {
    // Shoelace sobre coordenadas geográficas (aproximación plana local)
    const n    = this.vertices.length;
    if (n < 3) return 0;
    const cLat = this.vertices.reduce((s, v) => s + v.lat, 0) / n;
    const mLon = 111320 * Math.cos(cLat * Math.PI / 180);
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j  = (i + 1) % n;
      const xi = this.vertices[i].lon * mLon;
      const yi = this.vertices[i].lat * 111320;
      const xj = this.vertices[j].lon * mLon;
      const yj = this.vertices[j].lat * 111320;
      area += xi * yj - xj * yi;
    }
    return Math.round(Math.abs(area) / 2 / 10000 * 10) / 10;
  }
}

window.GeofenceDraw = GeofenceDraw;
