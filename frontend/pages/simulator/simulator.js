'use strict';
/**
 * Galicia Wildfire — Motor principal del Simulador
 * Fase 5+: mapa 3D + marcador Predator + HUD + Gamepad + RC override
 * Sistema de cámaras: Follow → Orbital → FPV (ciclo con R3)
 */

// ─── Game state desde planificación ──────────────────────────────────────────
const rawState  = sessionStorage.getItem('gw.gameState');
const gameState = rawState ? JSON.parse(rawState) : null;

const API      = () => window.APP_CONFIG?.API_URL      ?? 'http://localhost:8000';
const WS_TEL   = () => window.APP_CONFIG?.WS_TELEMETRY ?? 'ws://localhost:8000/ws/telemetry';
const WS_CTL   = () => window.APP_CONFIG?.WS_CONTROL   ?? 'ws://localhost:8000/ws/control';

const ZONE_CENTERS = {
  courel: [-7.05, 42.60], eume: [-8.05, 43.40],
  suido:  [-8.27, 42.37], pindo: [-9.07, 42.84],
};
const zoneCenter = gameState
  ? (ZONE_CENTERS[gameState.zone] ?? [-7.8, 42.7])
  : [-7.8, 42.7];

// ─── Cámara ───────────────────────────────────────────────────────────────────
// 0 = Follow | 1 = Orbital | 2 = FPV
const CAMERA_MODES = ['FOLLOW', 'ORBITAL', 'FPV'];
const cam = {
  mode:    0,
  orbital: { bearing: -15, pitch: 45 },
  fpv:     { bearingOffset: 0, pitchOffset: 0 },
};

// Límites de pitch por modo
const PITCH_LIMITS = {
  orbital: { min: 15, max: 80 },
  fpv:     { min: -20, max: 30 },   // relativo al pitch de FPV base (70°)
};
const FPV_BASE_PITCH = 68;

// ─── Estado ───────────────────────────────────────────────────────────────────
let mapgl        = null;
let droneMarker  = null;
let markerWrapEl = null;   // elemento raíz del marcador (MapLibre lo posiciona)
let droneEl      = null;   // wrapper de rotación yaw (hijo de markerWrapEl)
let droneLED     = null;
let hud          = null;
let ctrlWs       = null;
let gp           = null;
let geofence     = null;   // GeofenceDraw instance
let swarmRend    = null;   // SwarmRenderer instance
let lastTelemetry      = null;   // último dato para actualizar cámara orbital
let _pnoaActive        = false;
let _missionStartTs    = Date.now();   // timestamp inicio para el timer de debrief
let _geofencedAreaHa   = 0;           // suma de hectáreas geofenced
let _geofenceCount     = 0;           // número de geofences cerradas
let _burningCellsTotal = 0;           // máximo de celdas burning vistas (para % extinción)
let _extinguishedCells = 0;           // celdas que han pasado a BURNED
let _dbMissionId       = null;        // ID MongoDB de la misión activa (para debrief)

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const wsBanner      = document.getElementById('wsBanner');
const gamepadBanner = document.getElementById('gamepadBanner');
const gamepadName   = document.getElementById('gamepadName');
const gamepadScan   = document.getElementById('gamepadScan');
const mockBadge     = document.getElementById('mockBadge');
const btnMission    = document.getElementById('btnMission');
const fpvOverlay    = document.getElementById('fpvOverlay');
const fpvCoords     = document.getElementById('fpvCoords');
const fpvAlt        = document.getElementById('fpvAlt');
const camBadge      = document.getElementById('camBadge');
const btnPNOA       = document.getElementById('btnPNOA');
const btnFollow     = document.getElementById('btnFollow');
const btnBack       = document.getElementById('btnBack');
const geoStateEl    = document.getElementById('geoState');
const hudSwarm      = document.getElementById('hudSwarm');
const swarmDroneList= document.getElementById('swarmDroneList');
const swarmEta      = document.getElementById('swarmEta');
const debriefOverlay= document.getElementById('debriefOverlay');

const hudElements = {
  ias:             document.getElementById('hudIAS'),
  alt:             document.getElementById('hudALT'),
  hdg:             document.getElementById('hudHDG'),
  vspd:            document.getElementById('hudVSPD'),
  gspd:            document.getElementById('hudGSPD'),
  attitudeInner:   document.getElementById('attitudeInner'),
  rollVal:         document.getElementById('rollVal'),
  pitchVal:        document.getElementById('pitchVal'),
  modeBadge:       document.getElementById('modeBadge'),
  armBadge:        document.getElementById('armBadge'),
  btnArm:          document.getElementById('btnArm'),
  windDir:         document.getElementById('windDir'),
  windSpeed:       document.getElementById('windSpeed'),
  wpNum:           document.getElementById('wpNum'),
  wpDist:          document.getElementById('wpDist'),
  wpTotal:         document.getElementById('wpTotal'),
  // Cintas de telemetría — Operations Console
  compassStrip:        document.getElementById('compassTapeStrip'),
  compassHeadingLabel: document.getElementById('compassHeadingLabel'),
  compassWindPip:      document.getElementById('compassWindPip'),
  vtapeAltStrip:       document.getElementById('vtapeAltStrip'),
  vtapeAltValue:       document.getElementById('vtapeAltValue'),
  vtapeSpeedStrip:     document.getElementById('vtapeSpeedStrip'),
  vtapeSpeedValue:     document.getElementById('vtapeSpeedValue'),
  throttleFill:        document.getElementById('throttleFill'),
  throttleValue:       document.getElementById('throttleValue'),
  onArmedChange: (armed) => {
    setDroneLED(armed);
    if (armed) {
      window.GW_AUDIO?.arm();
      const badge = document.getElementById('armBadge');
      badge?.classList.remove('arm-flash');
      void badge?.offsetWidth;   // force reflow so animation restarts
      badge?.classList.add('arm-flash');
      setTimeout(() => badge?.classList.remove('arm-flash'), 550);
    } else {
      window.GW_AUDIO?.disarm();
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAPA
// ═══════════════════════════════════════════════════════════════════════════════

function initMap() {
  mapgl = new maplibregl.Map({
    container: 'map',
    style:     'https://tiles.openfreemap.org/styles/liberty',
    center:    zoneCenter,
    zoom:      13,
    pitch:     45,
    bearing:   -15,
    antialias: true,
    maxPitch:  85,
  });

  mapgl.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

  mapgl.on('load', () => {
    addTerrain();
    addPNOA();
    addSpreadLayers();   // fuentes GeoJSON para autómata (vacías al inicio)
    addFireLayers();
    createDroneMarker();
    initGeofence();      // GeofenceDraw (Phase 7) — añade capas al mapa
    initSwarmRenderer(); // SwarmRenderer (Phase 8) — añade capas al mapa
    togglePNOA(true);
  });

  // Si el usuario mueve el mapa manualmente → salir de Follow
  mapgl.on('dragstart',  () => { if (cam.mode === 0) { cam.mode = 1; updateCamBadge(); } });
  mapgl.on('pitchstart', () => { if (cam.mode === 0) { cam.mode = 1; updateCamBadge(); } });
}

function addTerrain() {
  const keyUrl = window.APP_CONFIG?.TERRAIN_TILE_URL ?? '';
  const hasKey = keyUrl && !keyUrl.includes('YOUR_MAPTILER_KEY');
  mapgl.addSource('terrain-src', hasKey ? {
    type: 'raster-dem', tiles: [keyUrl], tileSize: 256, maxzoom: 14,
  } : {
    type: 'raster-dem',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 15, encoding: 'terrarium',
  });
  mapgl.setTerrain({ source: 'terrain-src', exaggeration: 1.8 });
}

function addPNOA() {
  mapgl.addSource('pnoa-src', {
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
  mapgl.addLayer({
    id: 'pnoa-layer', type: 'raster', source: 'pnoa-src',
    layout: { visibility: 'none' },
    paint: { 'raster-opacity': 0.9 },
  });
}

function togglePNOA(forceOn) {
  _pnoaActive = forceOn !== undefined ? forceOn : !_pnoaActive;
  mapgl.setLayoutProperty('pnoa-layer', 'visibility', _pnoaActive ? 'visible' : 'none');
  btnPNOA.classList.toggle('active', _pnoaActive);
  btnPNOA.textContent = _pnoaActive ? 'PNOA ON' : 'PNOA';
}

// ─── Capas de propagación (autómata celular Fase 6) ──────────────────────────
function addSpreadLayers() {
  // Fuentes GeoJSON vacías — se actualizan en tiempo real vía WS fire_update
  mapgl.addSource('fire-burned-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapgl.addSource('fire-spread-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Celdas quemadas (gris carbón, bajo las llamas activas)
  mapgl.addLayer({
    id: 'fire-burned-fill', type: 'circle', source: 'fire-burned-src',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 10, 5, 16, 28],
      'circle-color':   '#1a1a1a',
      'circle-opacity': 0.72,
    },
  });

  // Celdas activas en llamas (naranja pulsante)
  mapgl.addLayer({
    id: 'fire-spread-fill', type: 'circle', source: 'fire-spread-src',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 10, 7, 16, 38],
      'circle-color':   '#e85d24',
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 16, 0.78],
      'circle-blur':    0.55,
    },
  });
}

let _lastSmokeTs = 0;

function spawnSmoke(cells) {
  const now = Date.now();
  if (now - _lastSmokeTs < 1800) return;
  _lastSmokeTs = now;

  const burning = cells.filter(c => c.state === 1);
  if (burning.length < 3) return;

  const count = Math.min(2, 1 + Math.floor(burning.length / 8));
  for (let i = 0; i < count; i++) {
    const cell = burning[Math.floor(Math.random() * burning.length)];
    const pt   = mapgl.project([cell.lon, cell.lat]);
    const el   = document.createElement('div');
    el.className = 'smoke-particle';
    el.style.left = `${pt.x + (Math.random() - 0.5) * 22}px`;
    el.style.top  = `${pt.y + (Math.random() - 0.5) * 12}px`;
    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }
}

function updateFireSpread(cells) {
  if (!mapgl || !mapgl.getSource('fire-spread-src')) return;
  const toFeature = c => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
    properties: {},
  });
  mapgl.getSource('fire-spread-src').setData({
    type: 'FeatureCollection', features: cells.filter(c => c.state === 1).map(toFeature),
  });
  mapgl.getSource('fire-burned-src').setData({
    type: 'FeatureCollection', features: cells.filter(c => c.state === 2).map(toFeature),
  });

  const hasBurning = cells.some(c => c.state === 1);
  if (hasBurning) {
    window.GW_AUDIO?.startFireCrackle();
    spawnSmoke(cells);
  } else {
    window.GW_AUDIO?.stopFireCrackle();
  }
}

// ─── Capas de focos ───────────────────────────────────────────────────────────
function addFireLayers() {
  if (!gameState?.fires?.length) return;

  const features = gameState.fires.map(f => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
    properties: { intensity: f.intensity ?? 1.0 },
  }));

  mapgl.addSource('fire-src', { type: 'geojson', data: { type: 'FeatureCollection', features } });

  mapgl.addLayer({
    id: 'fire-heat', type: 'circle', source: 'fire-src',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 50],
      'circle-color':   '#e85d24',
      'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 0.7],
      'circle-blur':    0.6,
    },
  });

  mapgl.addLayer({
    id: 'fire-core', type: 'circle', source: 'fire-src',
    paint: {
      'circle-radius':  ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 12],
      'circle-color':   '#f2a623',
      'circle-opacity': 0.95,
    },
  });

  // Marcadores SVG de llama — duración/delay aleatorio inline para evitar sincronía
  gameState.fires.forEach((fire, i) => {
    const el = document.createElement('div');
    el.className = 'fire-marker-sim';
    const gid = `fs${i}`;
    el.innerHTML = `<svg viewBox="0 0 20 24" width="20" height="24">
      <defs><linearGradient id="${gid}" x1="0%" y1="100%" x2="0%" y2="0%">
        <stop offset="0%" stop-color="#c0392b"/>
        <stop offset="55%" stop-color="#e85d24"/>
        <stop offset="100%" stop-color="#f2a623"/>
      </linearGradient></defs>
      <path d="M10,1 C7,5 5,9 7.5,12 C6,11 5,13 6.5,15 C7,13.5 7.5,14.5 10,16
               C12.5,14.5 13,13.5 13.5,15 C15,13 14,11 12.5,12 C15,9 13,5 10,1Z"
            fill="url(#${gid})"/>
    </svg>`;
    // nth-child selectors don't work here (each marker is sole child of its wrapper div)
    // → set stagger directly on the SVG element
    const svg = el.querySelector('svg');
    if (svg) {
      svg.style.animationDuration = `${1.2 + Math.random() * 0.85}s`;
      svg.style.animationDelay    = `${-Math.random() * 1.3}s`;
    }
    new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([fire.lon, fire.lat]).addTo(mapgl);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARCADOR DRON — MQ-9 REAPER PREDATOR SKIN
// ═══════════════════════════════════════════════════════════════════════════════

const PREDATOR_SVG = `
<svg viewBox="0 0 120 72" width="96" height="58" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Fuselaje cilíndrico: gradiente lateral izquierda→derecha -->
    <linearGradient id="pg-fuse" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#0d0d0d"/>
      <stop offset="12%"  stop-color="#4a4a4a"/>
      <stop offset="32%"  stop-color="#c8c8c8"/>
      <stop offset="50%"  stop-color="#eeeeee"/>
      <stop offset="68%"  stop-color="#b8b8b8"/>
      <stop offset="88%"  stop-color="#404040"/>
      <stop offset="100%" stop-color="#0d0d0d"/>
    </linearGradient>
    <!-- Spine dorsal: reflejo blanco de la cúpula del cilindro -->
    <linearGradient id="pg-spine" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="rgba(255,255,255,0.00)"/>
      <stop offset="38%"  stop-color="rgba(255,255,255,0.20)"/>
      <stop offset="50%"  stop-color="rgba(255,255,255,0.38)"/>
      <stop offset="62%"  stop-color="rgba(255,255,255,0.20)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0.00)"/>
    </linearGradient>
    <!-- Ala izquierda -->
    <linearGradient id="pg-wl" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%"   stop-color="#252525"/>
      <stop offset="18%"  stop-color="#7a7a7a"/>
      <stop offset="42%"  stop-color="#c0c0c0"/>
      <stop offset="60%"  stop-color="#d4d4d4"/>
      <stop offset="100%" stop-color="#606060"/>
    </linearGradient>
    <!-- Ala derecha (espejo) -->
    <linearGradient id="pg-wr" x1="100%" y1="0%" x2="0%" y2="0%">
      <stop offset="0%"   stop-color="#252525"/>
      <stop offset="18%"  stop-color="#7a7a7a"/>
      <stop offset="42%"  stop-color="#c0c0c0"/>
      <stop offset="60%"  stop-color="#d4d4d4"/>
      <stop offset="100%" stop-color="#606060"/>
    </linearGradient>
    <!-- Bola sensora EO/IR -->
    <radialGradient id="pg-ball" cx="33%" cy="28%" r="65%">
      <stop offset="0%"   stop-color="#ffffff"/>
      <stop offset="22%"  stop-color="#d4d4d4"/>
      <stop offset="55%"  stop-color="#5a5a5a"/>
      <stop offset="82%"  stop-color="#222222"/>
      <stop offset="100%" stop-color="#080808"/>
    </radialGradient>
    <!-- Bloom de calor del motor -->
    <radialGradient id="pg-heat" cx="50%" cy="45%" r="58%">
      <stop offset="0%"   stop-color="#ff8800" stop-opacity="0.88"/>
      <stop offset="50%"  stop-color="#ff3300" stop-opacity="0.50"/>
      <stop offset="100%" stop-color="#770000" stop-opacity="0.00"/>
    </radialGradient>
  </defs>

  <!-- ── ALA IZQUIERDA ─────────────────────────────────────── -->
  <!-- Borde de ataque: cara frontal del ala (grosor visible con perspectiva) -->
  <path d="M57,34 L4,42 L4,39 L57,31 Z"
        fill="#1a1a1a" opacity="0.88"/>
  <!-- Superficie superior del ala -->
  <path d="M57,34 L4,42 L5,47 L58,40 Z"
        fill="url(#pg-wl)" stroke="#111" stroke-width="0.5"/>
  <!-- Highlight especular -->
  <path d="M50,35.5 L11,42 L12,43 L51,36.5 Z"
        fill="rgba(255,255,255,0.13)"/>
  <!-- Winglet izquierdo -->
  <path d="M4,42 L0.5,36.5 L0.5,47 L5,47 Z"
        fill="#7a7a7a" stroke="#111" stroke-width="0.5"/>

  <!-- ── ALA DERECHA ────────────────────────────────────────── -->
  <path d="M63,34 L116,42 L116,39 L63,31 Z"
        fill="#1a1a1a" opacity="0.88"/>
  <path d="M63,34 L116,42 L115,47 L62,40 Z"
        fill="url(#pg-wr)" stroke="#111" stroke-width="0.5"/>
  <path d="M70,35.5 L109,42 L108,43 L69,36.5 Z"
        fill="rgba(255,255,255,0.13)"/>
  <path d="M116,42 L119.5,36.5 L119.5,47 L115,47 Z"
        fill="#7a7a7a" stroke="#111" stroke-width="0.5"/>

  <!-- ── FUSELAJE ───────────────────────────────────────────── -->
  <!-- Cuerpo principal — elipse alargada vista desde 3/4 superior -->
  <path d="M60,7
           C66,7 74,13 75,21
           L75,52
           C75,60 68,67 60,67
           C52,67 45,60 45,52
           L45,21
           C46,13 54,7 60,7 Z"
        fill="url(#pg-fuse)" stroke="#0a0a0a" stroke-width="1"/>
  <!-- Spine dorsal (highlight de la cúpula superior del cilindro) -->
  <path d="M60,7
           C63,7 67,12 68,19
           L68,52
           C68,59 64,65 60,65
           C56,65 52,59 52,52
           L52,19
           C53,12 57,7 60,7 Z"
        fill="url(#pg-spine)"/>

  <!-- Fairing de raíz de ala -->
  <ellipse cx="60" cy="37" rx="10" ry="5" fill="rgba(210,210,210,0.28)"/>

  <!-- Líneas estructurales de panel -->
  <line x1="47" y1="26" x2="73" y2="26" stroke="rgba(255,255,255,0.17)" stroke-width="0.7"/>
  <line x1="46" y1="38" x2="74" y2="38" stroke="rgba(255,255,255,0.17)" stroke-width="0.7"/>
  <line x1="47" y1="51" x2="73" y2="51" stroke="rgba(255,255,255,0.17)" stroke-width="0.7"/>

  <!-- Antena SATCOM / BLOS dorsal -->
  <rect x="58.5" y="21" width="3"  height="10" rx="1.5" fill="#383838" opacity="0.9"/>
  <rect x="57"   y="25" width="6"  height="1.2" rx="0.6" fill="#2a2a2a" opacity="0.8"/>

  <!-- ── COLA EN V (característica del MQ-9 Predator) ─────── -->
  <!-- Fin izquierdo — cara superior (iluminada) -->
  <path d="M54,58 L27,70 L28,68 L55,56 Z"
        fill="#8a8a8a" stroke="#181818" stroke-width="0.4"/>
  <!-- Fin izquierdo — cara inferior (oscura, da grosor) -->
  <path d="M54,58 L27,70 L27.5,71.5 L54.5,59 Z"
        fill="#2e2e2e" stroke="#111" stroke-width="0.4"/>
  <!-- Fin derecho — cara superior -->
  <path d="M66,58 L93,70 L92,68 L65,56 Z"
        fill="#8a8a8a" stroke="#181818" stroke-width="0.4"/>
  <!-- Fin derecho — cara inferior -->
  <path d="M66,58 L93,70 L92.5,71.5 L65.5,59 Z"
        fill="#2e2e2e" stroke="#111" stroke-width="0.4"/>

  <!-- ── BOLA SENSORA EO/IR (nariz) ────────────────────────── -->
  <circle cx="60" cy="11" r="10.5"
          fill="url(#pg-ball)" stroke="#080808" stroke-width="1.2"/>
  <!-- Reflejo especular principal -->
  <ellipse cx="55.5" cy="7.5" rx="3.8" ry="2.4" fill="rgba(255,255,255,0.58)" opacity="0.8"/>
  <!-- Lente oscura central -->
  <circle cx="60" cy="12" r="4.5" fill="rgba(0,0,0,0.65)"/>
  <circle cx="60" cy="12" r="2.5" fill="rgba(4,4,28,0.90)"/>
  <!-- Reflejo en lente -->
  <circle cx="58.4" cy="10.6" r="0.9" fill="rgba(140,195,255,0.65)"/>

  <!-- ── NACELA DEL MOTOR (empuje trasero) ─────────────────── -->
  <ellipse cx="60" cy="65.5" rx="7"   ry="3.5" fill="#070707" stroke="#040404" stroke-width="0.8"/>
  <ellipse cx="60" cy="66"   rx="5.5" ry="2.5" fill="rgba(35,35,35,0.75)"/>
  <!-- Bloom del escape IR -->
  <ellipse cx="60" cy="68.5" rx="10"  ry="5"   fill="url(#pg-heat)"/>

  <!-- ── LED DE PROA (apunta al frente = arriba del SVG) ───── -->
  <circle id="droneLED" cx="60" cy="2" r="3.5" fill="#00ff88" opacity="0.95"/>
  <circle cx="60" cy="2" r="5.5" fill="none" stroke="#00ff88" stroke-width="1" opacity="0.4"/>
</svg>`;

function createDroneMarker() {
  // markerWrapEl → MapLibre posiciona este con translate3d — no tocar su transform
  markerWrapEl = document.createElement('div');
  markerWrapEl.className = 'drone-marker-wrap';

  // Sombra proyectada en el suelo (no rota con el dron)
  const shadowEl = document.createElement('div');
  shadowEl.className = 'drone-ground-shadow';

  // droneEl = wrapper de rotación yaw — aquí aplicamos rotate(yaw)
  droneEl = document.createElement('div');
  droneEl.className = 'drone-rot-wrapper';

  // tiltEl = perspectiva 3D estática — perspective(82px) rotateX(40deg)
  const tiltEl = document.createElement('div');
  tiltEl.className = 'drone-3d-tilt';
  tiltEl.innerHTML = PREDATOR_SVG;

  droneEl.appendChild(tiltEl);
  markerWrapEl.appendChild(shadowEl);
  markerWrapEl.appendChild(droneEl);

  droneLED = tiltEl.querySelector('#droneLED');

  droneMarker = new maplibregl.Marker({ element: markerWrapEl, anchor: 'center' })
    .setLngLat(zoneCenter)
    .addTo(mapgl);
}

function setDroneLED(armed) {
  if (!droneLED) return;
  if (armed) {
    droneLED.classList.add('drone-led-armed');
    droneLED.setAttribute('opacity', '0.95');
  } else {
    droneLED.classList.remove('drone-led-armed');
    droneLED.setAttribute('opacity', '0.25');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SISTEMA DE CÁMARAS
// ═══════════════════════════════════════════════════════════════════════════════

function cycleCamera() {
  cam.mode = (cam.mode + 1) % CAMERA_MODES.length;
  updateCamBadge();

  if (cam.mode === 2) {
    // FPV: ocultar marcador completo, mostrar overlay
    if (markerWrapEl) markerWrapEl.style.display = 'none';
    fpvOverlay.classList.remove('hidden');
  } else {
    // Otras vistas: mostrar marcador, ocultar overlay FPV
    if (markerWrapEl) markerWrapEl.style.display = '';
    fpvOverlay.classList.add('hidden');
    // Restaurar orbital desde estado actual del mapa si venimos de FPV
    if (cam.mode === 1) {
      cam.orbital.bearing = mapgl.getBearing();
      cam.orbital.pitch   = mapgl.getPitch();
    }
  }

  // Aplicar cámara inmediatamente con la última telemetría
  if (lastTelemetry) applyCamera(lastTelemetry);
}

function handleDpad({ up, down, left, right }) {
  if (cam.mode === 0) return;   // Follow: D-pad no mueve cámara

  const BEARING_SPEED = 2.5;   // °/tick a 50Hz
  const PITCH_SPEED   = 0.8;

  if (cam.mode === 1) {
    // Orbital: bearing y pitch libres
    if (left)  cam.orbital.bearing = (cam.orbital.bearing - BEARING_SPEED + 360) % 360;
    if (right) cam.orbital.bearing = (cam.orbital.bearing + BEARING_SPEED) % 360;
    if (up)    cam.orbital.pitch   = Math.max(PITCH_LIMITS.orbital.min, cam.orbital.pitch - PITCH_SPEED);
    if (down)  cam.orbital.pitch   = Math.min(PITCH_LIMITS.orbital.max, cam.orbital.pitch + PITCH_SPEED);
    if (lastTelemetry) applyCamera(lastTelemetry);

  } else if (cam.mode === 2) {
    // FPV: offset relativo al heading del dron
    if (left)  cam.fpv.bearingOffset -= BEARING_SPEED;
    if (right) cam.fpv.bearingOffset += BEARING_SPEED;
    if (up)    cam.fpv.pitchOffset = Math.max(PITCH_LIMITS.fpv.min,  cam.fpv.pitchOffset - PITCH_SPEED);
    if (down)  cam.fpv.pitchOffset = Math.min(PITCH_LIMITS.fpv.max,  cam.fpv.pitchOffset + PITCH_SPEED);
    if (lastTelemetry) applyCamera(lastTelemetry);
  }
}

function applyCamera(data) {
  if (!mapgl) return;

  switch (cam.mode) {
    case 0:   // Follow — mapa sigue al dron con su heading
      mapgl.easeTo({
        center:   [data.lon, data.lat],
        bearing:  data.yaw,
        pitch:    45,
        duration: 120,
      });
      break;

    case 1:   // Orbital — cámara libre con D-pad, centrada en dron
      mapgl.easeTo({
        center:   [data.lon, data.lat],
        bearing:  cam.orbital.bearing,
        pitch:    cam.orbital.pitch,
        duration: 60,
      });
      break;

    case 2:   // FPV — heading del dron, pitch alto (vista hacia adelante)
      mapgl.easeTo({
        center:   [data.lon, data.lat],
        bearing:  (data.yaw + cam.fpv.bearingOffset + 360) % 360,
        pitch:    Math.min(85, FPV_BASE_PITCH + cam.fpv.pitchOffset),
        duration: 80,
      });
      // Actualizar info overlay FPV
      if (fpvCoords) fpvCoords.textContent = `${data.lat.toFixed(4)} / ${data.lon.toFixed(4)}`;
      if (fpvAlt)    fpvAlt.textContent    = `ALT ${Math.round(data.alt_rel)} m AGL`;
      break;
  }
}

function updateCamBadge() {
  if (!camBadge) return;
  const icons = ['◎ FOLLOW', '⊙ ORBITAL', '◈ FPV'];
  camBadge.textContent = icons[cam.mode];
  camBadge.dataset.mode = cam.mode;
}

// ─── Actualizar dron desde telemetría ────────────────────────────────────────
function updateDroneMarker(data) {
  if (!droneMarker) return;
  droneMarker.setLngLat([data.lon, data.lat]);
  // Rotar el wrapper interno (droneEl) — no el elemento de MapLibre (markerWrapEl)
  if (droneEl) droneEl.style.transform = `rotate(${data.yaw}deg)`;
  lastTelemetry = data;
  applyCamera(data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEOFENCE — Fase 7
// ═══════════════════════════════════════════════════════════════════════════════

function initGeofence() {
  geofence = new GeofenceDraw(mapgl, {
    onStart: () => {
      updateGeoHUD();
    },
    onVertex: (n) => {
      updateGeoHUD();
    },
    onClosed: (polygon, areaHa) => {
      _geofencedAreaHa += areaHa;
      _geofenceCount++;
      updateGeoHUD();
      launchSwarm(polygon, areaHa);
    },
    onReset: () => {
      updateGeoHUD();
    },
    onError: (msg) => {
      console.warn('[Geo]', msg);
    },
  });
}

function updateGeoHUD() {
  if (!geoStateEl || !geofence) return;
  switch (geofence.state) {
    case 'INACTIVE':
      geoStateEl.textContent = 'GEOFENCE: INACTIVA';
      geoStateEl.className   = 'geo-state';
      break;
    case 'RECORDING':
      geoStateEl.textContent = `● REC — ${geofence.vertices.length} vértices`;
      geoStateEl.className   = 'geo-state geo-rec';
      break;
    case 'CLOSED':
      geoStateEl.textContent = `✓ CERRADA — ${_geofencedAreaHa.toFixed(1)} ha`;
      geoStateEl.className   = 'geo-state geo-ok';
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENJAMBRE — Fase 8
// ═══════════════════════════════════════════════════════════════════════════════

function initSwarmRenderer() {
  swarmRend = new SwarmRenderer(mapgl, {
    onMissionComplete: () => {
      console.log('[Swarm] Misión completada');
      showDebrief();
    },
  });
}

async function launchSwarm(polygon, areaHa) {
  if (!gameState) return;
  try {
    const res = await fetch(`${API()}/api/game/launch-swarm`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        polygon,
        fire_ids:     gameState.fires?.map(f => f.id) ?? [],
        wind_dir_deg: gameState.wind?.direction_deg ?? 180,
        base_lat:     gameState.base?.lat ?? zoneCenter[1],
        base_lon:     gameState.base?.lon ?? zoneCenter[0],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    swarmRend.initSwarm(data);
    hudSwarm?.classList.remove('hidden');
    if (swarmEta) swarmEta.textContent = `ETA ~${Math.round(data.estimated_duration_s / 60)} min`;
    window.GW_AUDIO?.swarmLaunch();
    console.log('[Swarm] Lanzado:', data.swarm_id, `${data.n_drones} drones`);
  } catch (err) {
    console.warn('[Sim] launch-swarm error:', err.message);
  }
}

function updateSwarmHUD(drones) {
  if (!swarmDroneList || !hudSwarm) return;
  if (hudSwarm.classList.contains('hidden')) return;
  const STATUS_LABEL = { flying: 'VOLANDO', rtb: 'BASE RTB', reloading: 'CARGANDO', done: 'FIN' };
  swarmDroneList.innerHTML = drones.map(d => {
    const cls  = `swarm-status-${d.status}`;
    const lbl  = STATUS_LABEL[d.status] ?? d.status.toUpperCase();
    const water = d.status === 'flying' ? ` ${Math.round(d.water)}L` : '';
    return `<div><span style="opacity:.45">${d.id}</span> <span class="${cls}">${lbl}${water}</span></div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEBRIEF — Fase 9
// ═══════════════════════════════════════════════════════════════════════════════

function _stars(pct) {
  if (pct >= 90) return '★★★';
  if (pct >= 60) return '★★☆';
  return '★☆☆';
}

function showDebrief() {
  if (!debriefOverlay) return;

  const elapsed  = Math.round((Date.now() - _missionStartTs) / 1000);
  const mm       = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss       = String(elapsed % 60).padStart(2, '0');
  const timeFmt  = `${mm}:${ss}`;
  const timePct  = Math.max(0, 100 - elapsed / 36);   // mejor si más rápido

  const totalFires = gameState?.fires?.length ?? 0;
  const firesPct   = _geofenceCount >= totalFires ? 100 : Math.round(_geofenceCount / Math.max(1, totalFires) * 100);
  const areaPct    = Math.min(100, Math.round(_geofencedAreaHa / Math.max(1, totalFires) * 10));  // 10 ha por foco = 100%
  const extPct     = _burningCellsTotal > 0 ? Math.round(_extinguishedCells / _burningCellsTotal * 100) : 0;

  const score = Math.round(
    timePct   * 20 +
    firesPct  * 35 +
    areaPct   * 20 +
    extPct    * 25
  );

  document.getElementById('debriefZone').textContent    = gameState?.zone_name ?? '—';
  document.getElementById('dTime').textContent          = timeFmt;
  document.getElementById('dTimeStars').textContent     = _stars(timePct);
  document.getElementById('dFires').textContent         = `${_geofenceCount} / ${totalFires}`;
  document.getElementById('dFiresStars').textContent    = _stars(firesPct);
  document.getElementById('dArea').textContent          = `${_geofencedAreaHa.toFixed(1)} ha`;
  document.getElementById('dAreaStars').textContent     = _stars(areaPct);
  document.getElementById('dExtinct').textContent       = `${extPct}%`;
  document.getElementById('dExtinctStars').textContent  = _stars(extPct);

  // Animación contadora del score
  let displayed = 0;
  const el = document.getElementById('debriefScore');
  const step = Math.ceil(score / 40);
  const timer = setInterval(() => {
    displayed = Math.min(score, displayed + step);
    el.textContent = displayed.toLocaleString();
    if (displayed >= score) clearInterval(timer);
  }, 35);

  // Categoría de resultado
  const catEl = document.getElementById('debriefCategory');
  if (catEl) {
    let catClass, catText;
    if (score >= 75) { catClass = 'cat-excellent'; catText = 'EXCELENTE'; }
    else if (score >= 45) { catClass = 'cat-good'; catText = 'BUENO'; }
    else { catClass = 'cat-poor'; catText = 'MEJORABLE'; }
    catEl.className = `debrief-category ${catClass}`;
    catEl.textContent = catText;
  }

  debriefOverlay.classList.remove('hidden');
  window.GW_AUDIO?.debriefFanfare(score);
  window.GW_AUDIO?.stopFireCrackle();

  // Guardar resultado en MongoDB si hay misión activa
  if (_dbMissionId) {
    fetch(`${API()}/api/fleet/missions/${_dbMissionId}/end`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        score:                  score,
        fires_detected:         _geofenceCount,
        fires_extinguished:     Math.round(extPct / 100 * totalFires),
        geofence_coverage_pct:  areaPct,
        drones_lost:            0,
      }),
    }).catch(err => console.warn('[Fleet] No se pudo guardar debrief:', err.message));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKETS
// ═══════════════════════════════════════════════════════════════════════════════

// WS único: FastAPI:8000/ws/telemetry — telemetría MAVLink + fire_update + swarm_update
function initTelemetryWS() {
  let retryTimer;

  function connect() {
    const ws = new WebSocket(WS_TEL());

    ws.onopen  = () => wsBanner.classList.add('hidden');
    ws.onclose = () => {
      wsBanner.classList.remove('hidden');
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, 2000);
    };
    ws.onerror = () => {};
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'telemetry' && msg.data) {
          hud.update(msg.data);
          updateDroneMarker(msg.data);
          if (geofence) geofence.updateDronePos(msg.data.lat, msg.data.lon);
        } else if (msg.type === 'fire_update' && msg.cells) {
          updateFireSpread(msg.cells);
          const burning = msg.cells.filter(c => c.state === 1).length;
          const burned  = msg.cells.filter(c => c.state === 2).length;
          _burningCellsTotal = Math.max(_burningCellsTotal, burning + burned);
          _extinguishedCells = burned;
        } else if (msg.type === 'swarm_update' && msg.drones) {
          swarmRend?.update(msg);
          updateSwarmHUD(msg.drones);
        }
      } catch { /* noop */ }
    };
  }
  connect();
}

function initControlWS() {
  ctrlWs = new ControlWebSocket(WS_CTL(), {
    onOpen:  () => {},
    onClose: () => {},
    onReply: () => {},
  });
  ctrlWs.connect();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TECLADO — WASD + Q/E
// ═══════════════════════════════════════════════════════════════════════════════

const _keysHeld = new Set();
let   _rcLoopTimer = null;
const RC_STEP = 200;   // µs offset desde center (1500 ± 200 = 1300–1700)

function _startRCLoop() {
  if (_rcLoopTimer) return;
  _rcLoopTimer = setInterval(() => {
    if (!ctrlWs) return;
    const roll     = _keysHeld.has('a') ? 1500 - RC_STEP : _keysHeld.has('d') ? 1500 + RC_STEP : 1500;
    const pitch    = _keysHeld.has('w') ? 1500 - RC_STEP : _keysHeld.has('s') ? 1500 + RC_STEP : 1500;
    ctrlWs.sendRCOverride({ roll, pitch, throttle: 1500, yaw: 1500 });
  }, 50);   // 20 Hz
}

function _stopRCLoop() {
  clearInterval(_rcLoopTimer);
  _rcLoopTimer = null;
}

function initKeyboard() {
  const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const key = e.key.toLowerCase();

    if (MOVE_KEYS.has(key)) {
      e.preventDefault();
      _keysHeld.add(key);
      _startRCLoop();
      return;
    }

    if (key === 't') {
      e.preventDefault();
      btnMission?.click();
    } else if (key === 'q') {
      e.preventDefault();
      geofence?.addVertex();
    } else if (key === 'e') {
      e.preventDefault();
      geofence?.closeGeofence();
      window.GW_AUDIO?.geofenceClose();
    }
  });

  document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    _keysHeld.delete(key);
    const anyMove = MOVE_KEYS.has(key) && [...MOVE_KEYS].some(k => _keysHeld.has(k));
    if (!anyMove && MOVE_KEYS.has(key)) {
      ctrlWs?.sendRCOverride({ roll: 1500, pitch: 1500, throttle: 1500, yaw: 1500 });
      _stopRCLoop();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GAMEPAD
// ═══════════════════════════════════════════════════════════════════════════════

function initGamepad() {
  gp = new GamepadController({
    onRC: ({ ch1, ch2, ch3, ch4 }) => {
      ctrlWs?.sendRCOverride({ roll: ch1, pitch: ch2, throttle: ch3, yaw: ch4 });
    },

    onButton: (action) => {
      switch (action) {
        case 'arm':             ctrlWs?.send('arm');          break;
        case 'disarm':          ctrlWs?.send('disarm');       break;
        case 'start_mission':   btnMission?.click();          break;
        case 'mode_fbwa':       ctrlWs?.setMode('LOITER');    break;
        case 'mode_cruise':     ctrlWs?.setMode('ALT_HOLD'); break;
        case 'mode_rtl':        ctrlWs?.setMode('RTL');       break;
        case 'camera_cycle':    cycleCamera();                break;
        case 'geofence_vertex': geofence?.addVertex();                               break;
        case 'geofence_close':  geofence?.closeGeofence(); window.GW_AUDIO?.geofenceClose(); break;
      }
    },

    onConnect: (connected, name) => {
      gamepadBanner.classList.toggle('hidden', connected);
      if (gamepadName && name) {
        gamepadName.textContent = connected
          ? name.replace(/\s*\([^)]*\)/g, '').trim().slice(0, 40)
          : '';
      }
    },

    onDpad: handleDpad,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI BINDINGS
// ═══════════════════════════════════════════════════════════════════════════════

function bindUI() {
  btnPNOA?.addEventListener('click', () => togglePNOA());

  btnFollow?.addEventListener('click', () => {
    cam.mode = 0;
    cam.fpv  = { bearingOffset: 0, pitchOffset: 0 };
    fpvOverlay.classList.add('hidden');
    if (markerWrapEl) markerWrapEl.style.display = '';
    updateCamBadge();
    if (lastTelemetry) applyCamera(lastTelemetry);
  });

  btnBack?.addEventListener('click', () => window.location.href = '../planning/index.html');

  document.getElementById('btnArm')?.addEventListener('click', () => {
    const armed = document.getElementById('armBadge')?.classList.contains('armed');
    ctrlWs?.send(armed ? 'disarm' : 'arm');
  });

  btnMission?.addEventListener('click', () => {
    btnMission.classList.add('active');
    ctrlWs?.startMission();
    // Quitar estado activo tras 3 s (la misión ya habrá arrancado)
    setTimeout(() => btnMission?.classList.remove('active'), 3000);
  });

  // Botón de ajustes → modal de controles
  document.getElementById('btnSettings')?.addEventListener('click', () => {
    document.getElementById('settingsOverlay')?.classList.toggle('hidden');
  });
  document.getElementById('settingsClose')?.addEventListener('click', () => {
    document.getElementById('settingsOverlay')?.classList.add('hidden');
  });
  document.getElementById('settingsOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
  });

  document.getElementById('btnFBWA')?.addEventListener('click',   () => ctrlWs?.setMode('LOITER'));
  document.getElementById('btnCruise')?.addEventListener('click', () => ctrlWs?.setMode('ALT_HOLD'));
  document.getElementById('btnRTL')?.addEventListener('click',    () => ctrlWs?.setMode('RTL'));

  // Botón manual de scan de mando
  gamepadScan?.addEventListener('click', () => {
    gp?.scan();
    gamepadScan.textContent = 'BUSCANDO...';
    setTimeout(() => { gamepadScan.textContent = 'ESCANEAR'; }, 2000);
  });

  // Clic en badge de cámara también cicla
  camBadge?.addEventListener('click', cycleCamera);

  // Botones del debrief (Fase 9)
  document.getElementById('btnNewMission')?.addEventListener('click', () => {
    window.location.href = '../planning/index.html';
  });
  document.getElementById('btnMainMenu')?.addEventListener('click', () => {
    window.location.href = '../../index.html';
  });
}

// ─── Iniciar motor de propagación de incendio + crear misión en MongoDB ──────
async function startFires() {
  if (!gameState?.fires?.length) return;

  // Crear registro de misión en MongoDB (fleet API)
  try {
    const res = await fetch(`${API()}/api/fleet/missions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        zone:            gameState.zone,
        drone_call_sign: 'GW-RECCO-01',
        wind_speed:      Math.round(gameState.wind?.speed_kmh ?? 0),
        wind_dir:        Math.round(gameState.wind?.direction_deg ?? 0),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      _dbMissionId = data.id;
      console.log('[Fleet] Misión creada en DB:', _dbMissionId);
    }
  } catch (err) {
    console.warn('[Fleet] No se pudo crear misión en DB:', err.message);
  }

  // Arrancar motor de propagación de incendios
  try {
    await fetch(`${API()}/api/game/start-fires`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fires:          gameState.fires,
        wind_dir_deg:   gameState.wind?.direction_deg ?? 180,
        wind_speed_kmh: gameState.wind?.speed_kmh     ?? 20,
        difficulty:     gameState.difficulty          ?? 'Media',
      }),
      signal: AbortSignal.timeout(5000),
    });
    console.log('[Sim] Motor de fuego iniciado');
  } catch (err) {
    console.warn('[Sim] start-fires skipped:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SITL OVERLAY — UX de carga durante el arranque del SITL ArduCopter
// ═══════════════════════════════════════════════════════════════════════════════

const sitlOverlay     = document.getElementById('sitlOverlay');
const sitlLogEl       = document.getElementById('sitlLog');
const sitlProgressEl  = document.getElementById('sitlProgressFill');

function sitlShow() { sitlOverlay?.classList.remove('hidden'); }
function sitlHide() {
  if (!sitlOverlay) return;
  // Pequeño delay para mostrar el 100 % antes de cerrar
  setTimeout(() => sitlOverlay.classList.add('hidden'), 350);
}

function sitlProgress(pct) {
  if (sitlProgressEl) sitlProgressEl.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function sitlLog(line, cls = '') {
  if (!sitlLogEl) return;
  const ts  = new Date().toTimeString().slice(0, 8);
  const div = document.createElement('div');
  div.className = 'sitl-log-line' + (cls ? ' ' + cls : '');
  div.textContent = `[${ts}] ${line}`;
  sitlLogEl.appendChild(div);
  // Mantener solo las últimas 8 líneas
  while (sitlLogEl.children.length > 8) sitlLogEl.removeChild(sitlLogEl.firstChild);
  sitlLogEl.scrollTop = sitlLogEl.scrollHeight;
}

// ─── Arrancar SITL en la base y esperar conexión MAVLink ──────────────────────
async function startSITL() {
  if (!gameState?.base) return;
  const { lat, lon } = gameState.base;
  console.log('[Sim] Lanzando SITL en base:', lat, lon);

  sitlShow();
  sitlLog('gw.init: cargando perfil de misión', 'ok');
  sitlLog(`base: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  sitlProgress(10);

  // 1. Disparar el arranque (devuelve inmediatamente — SITL corre en background)
  try {
    sitlLog('POST /api/simulation/restart-at');
    const res = await fetch(`${API()}/api/simulation/restart-at`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ lat, lon, alt_m: 0 }),
      signal:  AbortSignal.timeout(8000),
    });
    const data = await res.json();
    console.log('[Sim] restart-at:', data);
    if (!data.starting) {
      // Modo external o ya conectado — no hay que esperar
      sitlLog('MAVLink ya disponible · sin reinicio', 'ok');
      sitlProgress(100);
      sitlHide();
      checkMockMode();
      return;
    }
    sitlLog('ArduCopter SITL · proceso lanzado', 'ok');
    sitlProgress(28);
  } catch (err) {
    console.warn('[Sim] restart-at skipped:', err.message);
    sitlLog(`backend no disponible (${err.message})`, 'warn');
    sitlLog('continuando en modo MOCK', 'warn');
    sitlProgress(100);
    sitlHide();
    return;
  }

  // 2. Polling de /api/simulation/status hasta que MAVLink conecte (máx 50 s)
  sitlLog('esperando heartbeat MAVLink...');
  console.log('[Sim] Esperando conexión MAVLink...');
  const startedAt = Date.now();
  const deadline  = startedAt + 50_000;
  let   attempt   = 0;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2500));
    attempt++;
    try {
      const res  = await fetch(`${API()}/api/simulation/status`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      console.log('[Sim] status:', JSON.stringify(data));
      // Progreso estimado: 28→90 % en función del tiempo
      const elapsed = (Date.now() - startedAt) / 1000;
      sitlProgress(28 + Math.min(62, elapsed / 50 * 62));
      if (!data.mavlink_mock) {
        console.log('[Sim] MAVLink conectado — telemetría real activa');
        sitlLog('heartbeat OK · telemetría real activa', 'ok');
        sitlProgress(100);
        sitlHide();
        checkMockMode();
        return;
      } else if (attempt % 3 === 0) {
        sitlLog(`polling status · intento #${attempt}`);
      }
    } catch { /* backend temporalmente ocupado, seguir esperando */ }
  }
  console.warn('[Sim] Timeout esperando SITL — continuando en mock');
  sitlLog('timeout esperando SITL · modo MOCK', 'warn');
  sitlProgress(100);
  sitlHide();
  checkMockMode();
}

// ─── Mock mode badge ──────────────────────────────────────────────────────────
async function checkMockMode() {
  try {
    const res  = await fetch(`${API()}/health`, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    mockBadge?.classList.toggle('hidden', !data.mavlink_mock);
  } catch { /* noop */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // AudioContext requires a user gesture before it can produce sound
  const unlockAudio = () => { window.GW_AUDIO?.unlock(); };
  document.addEventListener('click',   unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('gamepadconnected', unlockAudio, { once: true });

  if (!gameState) {
    document.getElementById('noMissionBanner')?.classList.remove('hidden');
  }

  _missionStartTs = Date.now();

  hud = new HUD(hudElements);
  if (gameState?.wind) {
    hud.setWind(gameState.wind.direction_deg, gameState.wind.speed_kmh);
  }

  updateCamBadge();
  initMap();
  initTelemetryWS();    // FastAPI:8000/ws/telemetry — MAVLink + fire + swarm
  initControlWS();
  initKeyboard();       // WASD (movimiento 20 Hz) + Q/E (geofence)
  initGamepad();
  bindUI();
  startSITL();    // fire-and-forget: apunta HOME a la base, conecta SITL real si disponible
  checkMockMode();
  startFires();
});
