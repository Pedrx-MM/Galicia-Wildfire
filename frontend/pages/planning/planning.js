'use strict';
/**
 * Galicia Wildfire — Pantalla de Planificación
 *
 * Flujo de interacción:
 *  1. Mapa MapLibre centra en Galicia (zoom 9)
 *  2. Usuario selecciona zona → flyTo con pitch 45
 *  3. Usuario hace clic en el mapa → marcador de base (arrastrable)
 *  4. Con zona + base: botón GENERAR MISIÓN se habilita
 *  5. GENERAR MISIÓN → POST /api/game/new-game → muestra condiciones meteorológicas
 *  6. INICIAR MISIÓN → guarda game_state en sessionStorage → navega al simulador
 */

// ─── Zonas (espejo del backend para no necesitar GET /zones al arrancar) ──────
const ZONES = {
  courel: {
    id: 'courel', name: 'Serra do Courel',
    code: 'GW-COU-01',
    center: [-7.05, 42.60], zoom: 13,
    description: 'Bosque denso de robles y castaños. Pendientes pronunciadas.',
    area_km2: 18, difficulty: 'Alta',
    terrain: 'mountain',
  },
  eume: {
    id: 'eume', name: 'Fragas do Eume',
    code: 'GW-EUM-02',
    center: [-8.05, 43.40], zoom: 13,
    description: 'Bosque atlántico costero. Viento predominante del noroeste.',
    area_km2: 12, difficulty: 'Media',
    terrain: 'forest',
  },
  suido: {
    id: 'suido', name: 'Serra do Suído',
    code: 'GW-SUI-03',
    center: [-8.27, 42.37], zoom: 13,
    description: 'Matorral y eucalipto. Propagación rápida en verano.',
    area_km2: 22, difficulty: 'Muy alta',
    terrain: 'scrub',
  },
  pindo: {
    id: 'pindo', name: 'Monte Pindo',
    code: 'GW-PIN-04',
    center: [-9.07, 42.84], zoom: 13,
    description: 'Granito y pino costero. Relieve irregular.',
    area_km2: 9, difficulty: 'Media',
    terrain: 'rocky',
  },
};

// ─── SVG de terreno por tipo (48×48 iconos esquemáticos) ────────────────────
const TERRAIN_SVG = {
  mountain: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" fill="#0c1410"/>
    <path d="M0,40 L12,22 L20,30 L30,14 L40,26 L48,20 L48,48 L0,48 Z" fill="#1a3420" opacity="0.7"/>
    <path d="M0,44 L12,28 L20,34 L30,20 L40,30 L48,26 L48,48 L0,48 Z" fill="#264a2f"/>
    <path d="M28,14 L30,17 L32,14 Z" fill="rgba(255,255,255,0.6)"/>
    <path d="M38,26 L40,29 L42,26 Z" fill="rgba(255,255,255,0.4)"/>
    <line x1="0" y1="40" x2="48" y2="40" stroke="rgba(232,93,36,0.3)" stroke-width="0.3" stroke-dasharray="1 2"/>
  </svg>`,
  forest: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" fill="#0c1410"/>
    <rect x="0" y="34" width="48" height="14" fill="#1a3420"/>
    <circle cx="8"  cy="32" r="7" fill="#264a2f"/>
    <circle cx="16" cy="30" r="8" fill="#2e5a38"/>
    <circle cx="26" cy="28" r="9" fill="#264a2f"/>
    <circle cx="36" cy="30" r="8" fill="#2e5a38"/>
    <circle cx="44" cy="32" r="6" fill="#264a2f"/>
    <rect x="7"  y="32" width="2" height="6" fill="#2a1a10"/>
    <rect x="15" y="32" width="2" height="8" fill="#2a1a10"/>
    <rect x="25" y="30" width="2" height="10" fill="#2a1a10"/>
    <rect x="35" y="32" width="2" height="8" fill="#2a1a10"/>
  </svg>`,
  scrub: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" fill="#120c08"/>
    <rect x="0" y="36" width="48" height="12" fill="#3a2a18"/>
    <path d="M4,36 Q6,32 8,36 Q10,30 12,36 Q14,33 16,36" stroke="#5a3a22" stroke-width="1" fill="none"/>
    <path d="M18,36 Q20,30 22,36 Q24,34 26,36 Q28,31 30,36" stroke="#6e4a2a" stroke-width="1" fill="none"/>
    <path d="M32,36 Q34,32 36,36 Q38,30 40,36 Q42,33 44,36" stroke="#5a3a22" stroke-width="1" fill="none"/>
    <circle cx="12" cy="38" r="3" fill="#5a3a22" opacity="0.7"/>
    <circle cx="28" cy="38" r="4" fill="#6e4a2a" opacity="0.7"/>
    <circle cx="40" cy="38" r="3" fill="#5a3a22" opacity="0.7"/>
    <path d="M0,20 L48,10" stroke="rgba(232,93,36,0.18)" stroke-width="0.4" stroke-dasharray="2 2"/>
  </svg>`,
  rocky: `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <rect width="48" height="48" fill="#0c0c0c"/>
    <path d="M0,42 L8,32 L14,38 L22,26 L30,34 L38,22 L48,32 L48,48 L0,48 Z" fill="#3a3a3a"/>
    <path d="M0,45 L8,36 L14,40 L22,30 L30,37 L38,26 L48,35 L48,48 L0,48 Z" fill="#2a2a2a"/>
    <polygon points="20,28 22,26 24,28 23,30" fill="rgba(255,255,255,0.3)"/>
    <polygon points="36,24 38,22 40,24 38,27" fill="rgba(255,255,255,0.3)"/>
    <circle cx="10" cy="38" r="1.5" fill="#555"/>
    <circle cx="30" cy="40" r="1.2" fill="#555"/>
  </svg>`,
};

// ─── Estado de la aplicación ──────────────────────────────────────────────────
const state = {
  map:          null,
  selectedZone: null,   // id de zona
  baseMarker:   null,   // maplibregl.Marker
  baseLngLat:   null,   // { lat, lng }
  placingBase:  false,
  gameState:    null,   // respuesta de new-game
  pnoaVisible:  false,
};

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const mapContainer  = document.getElementById('mapContainer');
const backendBadge  = document.getElementById('backendBadge');
const badgeDot      = document.getElementById('badgeDot');
const badgeText     = document.getElementById('badgeText');
const zoneCardsEl   = document.getElementById('zoneCards');
const baseHint      = document.getElementById('baseHint');
const baseCoordsEl  = document.getElementById('baseCoords');
const baseLat       = document.getElementById('baseLat');
const baseLon       = document.getElementById('baseLon');
const btnMoveBase   = document.getElementById('btnMoveBase');
const weatherSect   = document.getElementById('weatherSection');
const windNeedle    = document.getElementById('windNeedle');
const windSpeedVal  = document.getElementById('windSpeedVal');
const windDirVal    = document.getElementById('windDirVal');
const windAlert     = document.getElementById('windAlert');
const fireInfo      = document.getElementById('fireInfo');
const fireCountText = document.getElementById('fireCountText');
const btnGenerate   = document.getElementById('btnGenerate');
const btnStart      = document.getElementById('btnStart');
const btnPNOA       = document.getElementById('btnPNOA');
const mapToast      = document.getElementById('mapToast');

const API = () => window.APP_CONFIG?.API_URL ?? 'http://localhost:8000';

// ─── MapLibre: inicialización ─────────────────────────────────────────────────
function initMap() {
  state.map = new maplibregl.Map({
    container: 'map',
    style:     'https://tiles.openfreemap.org/styles/liberty',
    center:    [-7.8, 42.7],
    zoom:      9,
    pitch:     0,
    bearing:   0,
    antialias: true,
  });

  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  state.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

  state.map.on('load', onMapLoad);
}

function onMapLoad() {
  addTerrain();
  addPNOA();
  initMapClickHandler();
}

// ─── Terreno 3D ───────────────────────────────────────────────────────────────
function addTerrain() {
  const keyUrl = window.APP_CONFIG?.TERRAIN_TILE_URL ?? '';
  const hasKey = keyUrl && !keyUrl.includes('YOUR_MAPTILER_KEY');

  if (hasKey) {
    state.map.addSource('terrain-src', {
      type: 'raster-dem', tiles: [keyUrl], tileSize: 256, maxzoom: 14,
    });
  } else {
    // Fallback gratuito: Terrarium (AWS elevation tiles)
    state.map.addSource('terrain-src', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom:  15,
      encoding: 'terrarium',
    });
  }

  state.map.setTerrain({ source: 'terrain-src', exaggeration: 1.5 });
}

// ─── PNOA WMS (ortofoto) ──────────────────────────────────────────────────────
function addPNOA() {
  state.map.addSource('pnoa-src', {
    type: 'raster',
    tiles: [
      'https://www.ign.es/wms-inspire/pnoa-ma?' +
      'bbox={bbox-epsg-3857}&format=image/jpeg&service=WMS&version=1.1.1' +
      '&request=GetMap&srs=EPSG:3857&transparent=true&width=256&height=256' +
      '&layers=OI.OrthoimageCoverage',
    ],
    tileSize: 256,
    attribution: '© IGN España — PNOA',
  });

  state.map.addLayer({
    id:     'pnoa-layer',
    type:   'raster',
    source: 'pnoa-src',
    layout: { visibility: 'none' },   // oculto por defecto en planificación
    paint:  { 'raster-opacity': 0.85 },
  });
}

function togglePNOA() {
  state.pnoaVisible = !state.pnoaVisible;
  state.map.setLayoutProperty(
    'pnoa-layer', 'visibility',
    state.pnoaVisible ? 'visible' : 'none',
  );
  btnPNOA.classList.toggle('active', state.pnoaVisible);
  btnPNOA.textContent = state.pnoaVisible ? 'PNOA ON' : 'PNOA';
}

// ─── Clic en mapa para colocar base ──────────────────────────────────────────
function initMapClickHandler() {
  state.map.on('click', (e) => {
    if (!state.placingBase) return;
    placeBase(e.lngLat);
  });
}

function setPlacingBase(active) {
  state.placingBase = active;
  mapContainer.classList.toggle('placing-base', active);
}

function placeBase(lngLat) {
  if (state.baseMarker) {
    state.baseMarker.setLngLat(lngLat);
  } else {
    const el = _createBaseMarkerEl();
    state.baseMarker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
      .setLngLat(lngLat)
      .addTo(state.map);

    state.baseMarker.on('dragend', () => {
      state.baseLngLat = state.baseMarker.getLngLat();
      updateBaseDisplay(state.baseLngLat);
      updateButtonState();
      // Resetear misión si se mueve la base
      resetMission();
    });
  }

  state.baseLngLat = lngLat;
  updateBaseDisplay(lngLat);
  setPlacingBase(false);

  // Mostrar coordenadas, ocultar hint
  baseHint.classList.add('hidden');
  baseCoordsEl.classList.remove('hidden');

  updateButtonState();
  showToast('Base colocada — puedes arrastrarla para reposicionarla');
}

function updateBaseDisplay(lngLat) {
  baseLat.textContent = lngLat.lat.toFixed(5);
  baseLon.textContent = lngLat.lng.toFixed(5);
}

function _createBaseMarkerEl() {
  const el = document.createElement('div');
  el.className = 'base-marker-el';
  el.title = 'Base de operaciones (arrastrable)';
  el.innerHTML = `
    <svg viewBox="0 0 36 44" width="36" height="44" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="18" cy="42" rx="6" ry="2.5" fill="rgba(0,0,0,0.35)"/>
      <path d="M18,2 C10,2 4,8 4,16 C4,27 18,40 18,40 C18,40 32,27 32,16 C32,8 26,2 18,2 Z"
            fill="#c0392b" stroke="#7a1818" stroke-width="1.5"/>
      <text x="18" y="21" text-anchor="middle" dominant-baseline="middle"
            fill="white" font-size="13" font-weight="700"
            font-family="Inter,system-ui,sans-serif">H</text>
    </svg>`;
  return el;
}

// ─── Zone cards ───────────────────────────────────────────────────────────────
function renderZoneCards() {
  const diffClass = { 'Media': 'media', 'Alta': 'alta', 'Muy alta': 'muyalta' };

  Object.values(ZONES).forEach(zone => {
    const diff = diffClass[zone.difficulty] ?? 'media';
    const card = document.createElement('div');
    card.className  = 'zone-card';
    card.dataset.id = zone.id;
    card.dataset.difficulty = diff;
    card.innerHTML  = `
      <div class="zone-card-body">
        <div class="zone-terrain">${TERRAIN_SVG[zone.terrain] ?? TERRAIN_SVG.mountain}</div>
        <div class="zone-info">
          <div class="zone-card-header">
            <span class="zone-name">${zone.name}</span>
            <span class="zone-code">${zone.code}</span>
          </div>
          <p class="zone-desc">${zone.description}</p>
          <p class="zone-meta">
            <span>◇ ${zone.area_km2} km²</span>
            <span class="zone-difficulty ${diff}">${zone.difficulty}</span>
          </p>
        </div>
      </div>`;

    card.addEventListener('click', () => selectZone(zone.id));
    zoneCardsEl.appendChild(card);
  });
}

function selectZone(id) {
  if (state.selectedZone === id) return;

  // Actualizar selección visual
  document.querySelectorAll('.zone-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === id);
  });

  state.selectedZone = id;
  const zone = ZONES[id];

  // flyTo hacia la zona
  state.map.flyTo({
    center:   zone.center,
    zoom:     zone.zoom,
    pitch:    45,
    bearing:  -15,
    duration: 1800,
    essential: true,
  });

  // Si ya había misión generada, resetearla (cambio de zona la invalida)
  resetMission();
  updateButtonState();

  // Si no hay base, activar modo colocar base automáticamente
  if (!state.baseLngLat) {
    setPlacingBase(true);
    showToast('Haz clic en el mapa para colocar la base de operaciones');
  }
}

// ─── Estado del botón ─────────────────────────────────────────────────────────
function updateButtonState() {
  const ready = state.selectedZone && state.baseLngLat;
  btnGenerate.disabled = !ready;
}

function resetMission() {
  state.gameState = null;
  weatherSect.classList.add('hidden');
  btnStart.classList.add('hidden');
  btnGenerate.classList.remove('hidden');
  btnGenerate.textContent = '';
  btnGenerate.innerHTML   = '<span class="btn-icon">▶</span> GENERAR MISIÓN';
}

// ─── Generación de misión ─────────────────────────────────────────────────────
async function generateMission() {
  if (!state.selectedZone || !state.baseLngLat) return;

  btnGenerate.disabled = true;
  btnGenerate.innerHTML = '<span class="btn-icon">⟳</span> GENERANDO...';

  try {
    const res = await fetch(`${API()}/api/game/new-game`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone:     state.selectedZone,
        base_lat: state.baseLngLat.lat,
        base_lon: state.baseLngLat.lng,
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    state.gameState = await res.json();
    showWeather(state.gameState);

    // Transición a INICIAR MISIÓN
    btnGenerate.classList.add('hidden');
    btnStart.classList.remove('hidden');
    weatherSect.classList.remove('hidden');

    // Mostrar focos en el mapa
    renderFireMarkers(state.gameState.fires);

  } catch (err) {
    console.error('[Planning] new-game error:', err);
    showToast(`Error al generar misión: ${err.message}`);
    btnGenerate.disabled = false;
    btnGenerate.innerHTML = '<span class="btn-icon">▶</span> GENERAR MISIÓN';
  }
}

// ─── Meteorología ─────────────────────────────────────────────────────────────
function showWeather(data) {
  const { wind, fire_count } = data;

  windSpeedVal.textContent = Math.round(wind.speed_kmh);
  windDirVal.textContent   = `${wind.direction_deg}° — ${_cardinalDir(wind.direction_deg)}`;

  // Rotar la aguja de la rosa de los vientos (cx/cy = 50/50 en el nuevo SVG)
  windNeedle.setAttribute('transform', `rotate(${wind.direction_deg}, 50, 50)`);

  // Dibujar cono de impacto (sector hacia donde SE DIRIGE el viento)
  _drawWindImpactCone(wind.direction_deg, wind.speed_kmh);

  // Alerta de viento
  windAlert.className = 'wind-alert';
  if (wind.speed_kmh < 20) {
    windAlert.classList.add('calm');
    windAlert.textContent = '◎ VIENTO FAVORABLE';
  } else if (wind.speed_kmh <= 40) {
    windAlert.classList.add('mod');
    windAlert.textContent = '⚠ VIENTO MODERADO';
  } else {
    windAlert.classList.add('strong');
    windAlert.textContent = '⚠ VIENTO FUERTE · ALTO RIESGO';
  }

  // Focos
  fireCountText.textContent =
    `${fire_count} foco${fire_count !== 1 ? 's' : ''} de ignición detectado${fire_count !== 1 ? 's' : ''}`;
}

/**
 * Dibuja un cono (sector circular) que indica hacia dónde
 * se propagará el fuego empujado por el viento.
 *   - direction_deg = procedencia del viento (meteorológica, FROM)
 *   - El fuego se propaga en la dirección opuesta (TO)
 *   - Amplitud del cono aumenta con la velocidad del viento
 */
function _drawWindImpactCone(fromDeg, speedKmh) {
  const coneEl = document.getElementById('windImpactCone');
  if (!coneEl) return;

  const cx = 50, cy = 50, r = 46;
  const toDeg = (fromDeg + 180) % 360;
  // Amplitud del cono: 30° a 20 km/h, 60° a 60 km/h (clamp 25°-70°)
  const halfAngle = Math.min(70, Math.max(25, 25 + speedKmh * 0.6)) / 2;

  // SVG: 0° = arriba; ángulos van en sentido horario (como la brújula)
  const a1 = (toDeg - halfAngle - 90) * Math.PI / 180;
  const a2 = (toDeg + halfAngle - 90) * Math.PI / 180;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy + r * Math.sin(a2);
  const largeArc = halfAngle * 2 > 180 ? 1 : 0;

  coneEl.setAttribute('d',
    `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`);
}

function _cardinalDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// ─── Marcadores de focos en el mapa ──────────────────────────────────────────
function renderFireMarkers(fires) {
  // Limpiar anteriores
  document.querySelectorAll('.fire-marker').forEach(el => el.remove());

  fires.forEach(fire => {
    const el = document.createElement('div');
    el.className = 'fire-marker';
    el.title     = `Foco ${fire.id}`;
    el.innerHTML = `
      <svg viewBox="0 0 24 28" width="24" height="28" xmlns="http://www.w3.org/2000/svg">
        <ellipse cx="12" cy="27" rx="5" ry="1.5" fill="rgba(0,0,0,0.3)"/>
        <path d="M12,2 C8,6 6,10 8.5,13 C7,12 6,14 7.5,16 C8,14 9,15.5 12,17.5 C15,15.5 16,14 16.5,16 C18,14 17,12 15.5,13 C18,10 16,6 12,2Z"
              fill="url(#fg${fire.id})"/>
        <defs>
          <linearGradient id="fg${fire.id}" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#c0392b"/>
            <stop offset="60%" stop-color="#e85d24"/>
            <stop offset="100%" stop-color="#f2a623"/>
          </linearGradient>
        </defs>
      </svg>`;

    new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([fire.lon, fire.lat])
      .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(
        `<strong>Foco ${fire.id}</strong><br>
         Intensidad: ${fire.intensity}<br>
         Área: ${fire.area_m2} m²<br>
         ${fire.lat.toFixed(5)}, ${fire.lon.toFixed(5)}`
      ))
      .addTo(state.map);
  });
}

// ─── INICIAR MISIÓN ───────────────────────────────────────────────────────────
async function startMission() {
  if (!state.gameState) return;

  btnStart.disabled = true;
  btnStart.innerHTML = '<span class="btn-icon">⟳</span> PREPARANDO SITL...';

  try {
    // Subir waypoints de los focos al autopiloto (el arranque de SITL lo gestiona el simulador)
    btnStart.innerHTML = '<span class="btn-icon">⟳</span> SUBIENDO MISIÓN...';
    await fetch(`${API()}/api/simulation/upload-mission`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fires:         state.gameState.fires,
        base:          { lat: state.baseLngLat.lat, lon: state.baseLngLat.lng },
        cruise_alt_m:  120,
        loiter_time_s: 30,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn('[Planning] upload-mission skipped:', err.message);
  }

  // 3. Guardar estado y navegar al simulador
  sessionStorage.setItem('gw.gameState', JSON.stringify(state.gameState));
  window.location.href = '../simulator/index.html';
}

// ─── Estado del backend ───────────────────────────────────────────────────────
const fleetCountEl = document.getElementById('fleetCount');

async function checkBackendStatus() {
  try {
    const res = await fetch(`${API()}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    backendBadge.className = 'backend-badge online';
    badgeText.textContent  = 'Backend online';
    fetchFleetCount();
  } catch {
    backendBadge.className = 'backend-badge offline';
    badgeText.textContent  = 'Backend offline';
    if (fleetCountEl) fleetCountEl.textContent = '';
  }
}

async function fetchFleetCount() {
  try {
    const res  = await fetch(`${API()}/api/fleet/drones/available`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = await res.json();
    if (fleetCountEl) fleetCountEl.textContent = `· ${data.length} drones`;
    // Hacer el badge clickeable para abrir la tab FLOTA
    if (data.length > 0) {
      backendBadge.classList.add('has-fleet');
      backendBadge.title = 'Ver flota de drones';
    }
  } catch {
    if (fleetCountEl) fleetCountEl.textContent = '';
  }
}

// ─── FLEET TAB ────────────────────────────────────────────────────────────────

let _fleetData = [];

function switchTab(name) {
  document.querySelectorAll('.panel-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.getElementById('panelMission').classList.toggle('hidden', name !== 'mission');
  document.getElementById('panelFleet').classList.toggle('hidden', name !== 'fleet');
  if (name === 'fleet') loadFleet();
}

function initTabs() {
  document.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
  // El badge de drones del header también abre el tab FLOTA al hacer clic
  const badge = document.getElementById('backendBadge');
  if (badge) {
    badge.addEventListener('click', () => {
      if (badge.classList.contains('has-fleet')) switchTab('fleet');
    });
  }
}

async function loadFleet() {
  try {
    const res = await fetch(`${API()}/api/fleet/drones`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _fleetData = await res.json();
    renderFleetTable(_fleetData);
    renderFleetSummary(_fleetData);
  } catch (err) {
    document.getElementById('fleetTbody').innerHTML =
      `<tr><td colspan="6" class="fleet-loading">Error cargando flota: ${err.message}</td></tr>`;
  }
}

function renderFleetSummary(drones) {
  document.getElementById('statAvailable').textContent   = drones.filter(d => d.status === 'available').length;
  document.getElementById('statMaintenance').textContent = drones.filter(d => d.status === 'maintenance').length;
  document.getElementById('statMission').textContent     = drones.filter(d => d.status === 'on_mission').length;
}

function renderFleetTable(drones) {
  const tbody = document.getElementById('fleetTbody');
  if (!drones.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="fleet-loading">Sin drones registrados</td></tr>';
    return;
  }

  tbody.innerHTML = drones.map(d => {
    const isRetired = d.status === 'retired';
    const statusOpts = ['available','on_mission','maintenance','retired']
      .map(s => `<option value="${s}"${d.status === s ? ' selected' : ''}>${_statusLabel(s)}</option>`)
      .join('');

    return `<tr class="${isRetired ? 'retired' : ''}" data-id="${d.id}">
      <td class="mono-cell">${d.call_sign}</td>
      <td style="color:var(--color-text-muted);font-size:10px">${d.model || '—'}</td>
      <td>
        ${isRetired
          ? `<span class="status-badge status-retired">BAJA</span>`
          : `<select class="status-select" onchange="updateDroneStatus('${d.id}', this.value)">${statusOpts}</select>`
        }
      </td>
      <td style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-muted)">${d.autonomy_min ?? '—'} min</td>
      <td style="font-family:var(--font-mono);font-size:10px;color:var(--color-text-muted)">${d.area_mojado_m2 ? d.area_mojado_m2 + ' m²' : '—'}</td>
      <td>${isRetired ? '' : `<button class="btn-retire" onclick="retireDrone('${d.id}','${d.call_sign}')">Baja</button>`}</td>
    </tr>`;
  }).join('');
}

async function updateDroneStatus(id, status) {
  try {
    const res = await fetch(`${API()}/api/fleet/drones/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadFleet();
  } catch (err) {
    showToast(`Error actualizando estado: ${err.message}`);
  }
}

async function retireDrone(id, callSign) {
  if (!confirm(`Dar de baja ${callSign}? Se marcara como retirado.`)) return;
  try {
    const res = await fetch(`${API()}/api/fleet/drones/${id}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showToast(`${callSign} dado de baja`);
    await loadFleet();
  } catch (err) {
    showToast(`Error: ${err.message}`);
  }
}

function _statusLabel(s) {
  return { available: 'Disponible', on_mission: 'En mision', maintenance: 'Mantenimiento', retired: 'Baja' }[s] ?? s;
}

function initFleetForm() {
  const btnAdd     = document.getElementById('btnAddDrone');
  const btnCancel  = document.getElementById('btnCancelAdd');
  const btnConfirm = document.getElementById('btnConfirmAdd');
  const form       = document.getElementById('fleetAddForm');

  btnAdd.addEventListener('click', () => {
    form.classList.remove('hidden');
    btnAdd.classList.add('hidden');
  });

  btnCancel.addEventListener('click', () => {
    form.classList.add('hidden');
    btnAdd.classList.remove('hidden');
    _clearFleetForm();
  });

  btnConfirm.addEventListener('click', async () => {
    const callSign = document.getElementById('fCallSign').value.trim();
    const model    = document.getElementById('fModel').value.trim();
    const type     = document.getElementById('fType').value;
    const autonomy = parseInt(document.getElementById('fAutonomy').value) || 30;
    const area     = parseInt(document.getElementById('fArea').value) || 0;

    if (!callSign || !model) {
      showToast('Call sign y modelo son obligatorios');
      return;
    }

    btnConfirm.disabled = true;
    btnConfirm.textContent = 'Creando...';
    try {
      const res = await fetch(`${API()}/api/fleet/drones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_sign: callSign, model, type, autonomy_min: autonomy, area_mojado_m2: area }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail ?? `HTTP ${res.status}`);
      }
      form.classList.add('hidden');
      btnAdd.classList.remove('hidden');
      _clearFleetForm();
      showToast(`Dron ${callSign} creado`);
      await loadFleet();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      btnConfirm.disabled = false;
      btnConfirm.textContent = 'Crear dron';
    }
  });
}

function _clearFleetForm() {
  ['fCallSign','fModel','fAutonomy','fArea'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('fType').selectedIndex = 0;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, duration = 3500) {
  mapToast.textContent = msg;
  mapToast.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => mapToast.classList.add('hidden'), duration);
}

// ─── Binding de UI ────────────────────────────────────────────────────────────
function bindUI() {
  btnGenerate.addEventListener('click', generateMission);
  btnStart.addEventListener('click', startMission);
  btnMoveBase.addEventListener('click', () => {
    setPlacingBase(true);
    showToast('Haz clic en el mapa para recolocar la base');
  });
  btnPNOA.addEventListener('click', togglePNOA);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  renderZoneCards();
  bindUI();
  initTabs();
  initFleetForm();
  checkBackendStatus();
  setInterval(checkBackendStatus, 30_000);
});
