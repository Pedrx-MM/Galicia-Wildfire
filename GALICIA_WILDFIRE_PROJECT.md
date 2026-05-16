# Galicia Wildfire Drone Simulator — Project Specification

> **Documento de diseño completo para Claude Code.**  
> Leer en su totalidad antes de generar cualquier archivo. Respetar toda decisión de arquitectura marcada como NO CAMBIAR.

---

## 1. Visión del Proyecto

Aplicación web de simulación táctica de extinción de incendios forestales mediante drones de ala fija. El usuario actúa como piloto de reconocimiento: vuela sobre terreno boscoso real de Galicia, localiza focos de incendio activos, delimita su perímetro dibujando geofences en vuelo y ordena el despliegue de un enjambre autónomo de drones cisterna que ejecuta las pasadas de extinción.

La aplicación tiene dos capas simultáneas: herramienta de entrenamiento operativo con datos reales y juego de estrategia con mecánicas de puntuación. El stack técnico prioriza software libre al 100%.

---

## 2. Stack Tecnológico

| Capa | Tecnología | Versión | Notas |
|------|-----------|---------|-------|
| Frontend | Vanilla JS + HTML5 + CSS3 | — | Sin frameworks SPA |
| Mapa 3D | MapLibre GL JS | 4.7.1 | Terrain-3D nativo |
| Terreno | MapTiler terrain-rgb tiles | — | O fallback OpenTopoData SRTM |
| Ortofoto | PNOA IGN España (WMS) | — | Gratuito, 25 cm resolución |
| Backend API | FastAPI (Python 3.11+) | latest | REST + comandos discretos |
| WS Bridge | ws_bridge.py (Python) | — | WebSocket real-time + RC override |
| MAVLink | PyMAVLink | 2.x | Protocolo dron ↔ ws_bridge + FastAPI |
| SITL | ArduPlane (ArduPilot) en WSL2 | latest | Ala fija, no quadcóptero |
| Controlador | Gamepad API (navegador nativo) | — | Xbox USB, sin drivers extra |
| WebSocket RT | websockets (Python lib) | 13.x | ws_bridge servidor WS:8765 |
| Base de datos | MongoDB 7 (Docker) | — | Flota + misiones + telemetría |
| DB driver | Motor (async pymongo) | 3.x | Acceso async MongoDB desde FastAPI |
| Servidor dev | Python http.server / Vite | — | Frontend estático |

**Dependencias Python:** `fastapi`, `uvicorn`, `pymavlink`, `websockets`, `motor`, `pymongo`, `python-dotenv`  
**Dependencias JS:** MapLibre GL JS 4.7.1 (CDN), sin npm obligatorio para el frontend.

---

## 3. Estructura de Archivos

```
galicia-wildfire/
├── README.md
├── start.bat                        # Arranque Windows (MongoDB + ws_bridge + backend + frontend)
├── shutdown.bat                     # Cierre limpio de todos los procesos
├── docker-compose.yml               # MongoDB en Docker
├── backend/
│   ├── main.py                      # FastAPI app + lifespan + Motor MongoDB init
│   ├── config.py                    # Constantes globales, puertos, coordenadas SITL
│   ├── .env                         # Variables de entorno (NO subir a git)
│   ├── ws_bridge/
│   │   ├── __init__.py
│   │   └── ws_bridge.py             # WS server :8765 + TCP server :14555 + MAVLink parser
│   ├── db/
│   │   └── mongo_init.py            # Inserta flota inicial si colección vacía
│   ├── mavlink/
│   │   ├── connection.py            # MAVLink connection manager + _read_loop (thread-safe)
│   │   ├── telemetry.py             # Parsing mensajes ATTITUDE, GPS, HEARTBEAT, VFR_HUD
│   │   ├── commands.py              # arm/disarm, set_mode, takeoff, rc_override
│   │   └── mission.py              # Upload/download misión ArduPlane waypoints
│   ├── api/
│   │   ├── routes/
│   │   │   ├── health.py            # GET /health
│   │   │   ├── control.py           # POST arm, mode, takeoff
│   │   │   ├── mission.py           # POST upload, GET download
│   │   │   ├── simulation.py        # POST restart-at (cambio home SITL dinámico)
│   │   │   ├── game.py              # POST new-game, GET zones, POST generate-fires
│   │   │   └── fleet.py             # GET/PUT /api/fleet/* — Motor → MongoDB
│   │   └── websockets/
│   │       ├── telemetry_ws.py      # WS /ws/telemetry — fallback si ws_bridge no disponible
│   │       └── control_ws.py        # WS /ws/control — fallback si ws_bridge no disponible
│   ├── game/
│   │   ├── fire_engine.py           # Autómata celular de propagación de fuego
│   │   ├── wind.py                  # Generación aleatoria de viento (dirección + velocidad)
│   │   ├── swarm.py                 # Cálculo de pasadas boustrophedon dentro de geofence
│   │   └── zones.py                 # Metadatos de las 4 zonas de Galicia
│   └── simulation/
│       └── sitl_manager.py          # Gestión del proceso ArduPlane SITL (start/stop/restart)
└── frontend/
    ├── index.html                   # Punto de entrada — carga splash screen
    ├── assets/
    │   ├── fonts/                   # Fuentes locales si se necesitan
    │   └── sounds/
    │       ├── wind_ambient.mp3     # Sonido ambiental de viento (opcional)
    │       └── water_drop.mp3       # Sonido de descarga de agua dron (opcional)
    ├── pages/
    │   ├── splash/
    │   │   ├── splash.html          # Pantalla de carga con logo + animación + barra
    │   │   ├── splash.css
    │   │   └── splash.js            # Control de barra de progreso + transición
    │   ├── planning/
    │   │   ├── index.html           # Selección de zona + colocación de base
    │   │   ├── planning.css
    │   │   └── planning.js          # MapLibre minimapa, zona picker, wind briefing
    │   └── simulator/
    │       ├── index.html           # Vista principal de vuelo + HUD + geofence + enjambre
    │       ├── simulator.css
    │       └── simulator.js         # Motor principal del simulador
    ├── components/
    │   ├── hud/
    │   │   ├── hud.js               # HUD: speed, altitude, heading, pitch, roll
    │   │   └── hud.css
    │   ├── gamepad/
    │   │   └── gamepad.js           # Gamepad API: polling loop, mapeo Xbox → RC channels
    │   ├── fire/
    │   │   └── fire_renderer.js     # Renderizado GeoJSON fuego sobre MapLibre
    │   ├── geofence/
    │   │   └── geofence_draw.js     # Captura vértices, cierre de polígono, preview
    │   └── swarm/
    │       └── swarm_renderer.js    # Animación enjambre: iconos dron + trayectorias
    └── services/
        ├── telemetry.js             # WebSocket telemetría + event bus
        ├── control.js               # WebSocket control + envío RC override
        └── api.js                   # Fetch wrapper para REST endpoints
```

---

## 4. Pantalla Splash (Carga Inicial)

### 4.1 Descripción visual

La pantalla de carga es la primera impresión. Debe transmitir la identidad del proyecto: urgencia, naturaleza, tecnología. Se muestra en `frontend/pages/splash/splash.html` y es la página que carga `index.html` directamente.

### 4.2 Composición de elementos

**Fondo:** Negro profundo (`#0a0a0a`) con una textura muy sutil de humo o partículas de ceniza animadas (CSS puro, `@keyframes`, sin canvas).

**Logo central (SVG inline):**
- Silueta estilizada de pinos gallegos (2-3 árboles) en llamas
- Las llamas son formas orgánicas en gradiente naranja → rojo → amarillo con animación de parpadeo suave (`@keyframes flicker`, opacidad 0.8 → 1.0, duración 0.8s alternado)
- El tronco y copa de los árboles en color gris carbón (`#2a2a2a`) con trazo fino blanco roto (`#e8e0d0`)
- Tamaño del logo SVG: 180 × 200 px, centrado

**Nombre de la aplicación:**
- Texto principal: `GALICIA WILDFIRE` — fuente monoespaciada o sans-serif condensada, blanco puro, tamaño 42px, `letter-spacing: 0.15em`
- Subtítulo: `Sistema de extinción autónoma · Drones UAV` — color naranja apagado (`#c8640a`), 14px, `letter-spacing: 0.08em`
- Separación entre logo y texto: 28px

**Barra de progreso:**
- Aparece 400ms después del logo
- Ancho: 320px, altura: 3px
- Fondo de la barra: `rgba(255,255,255,0.1)`
- Relleno: gradiente lineal `#e85d24 → #f2a623`
- Sin borde redondeado (barra recta industrial)
- Debajo de la barra: texto de estado que cambia durante la carga:
  - 0%–20%: `Inicializando sistema MAVLink...`
  - 20%–45%: `Cargando cartografía de Galicia...`
  - 45%–70%: `Generando modelos de terreno...`
  - 70%–90%: `Calibrando simulador de vuelo...`
  - 90%–100%: `Sistema listo`
- Texto de estado: color `rgba(255,255,255,0.5)`, 12px, monoespaciado

**Duración total de la barra:** 3.2 segundos. Progreso no lineal: arranca rápido, se ralentiza en 60-80%, acelera al final (función ease personalizada mediante `setTimeout` escalonados).

### 4.3 Animación del dron de paso

Cuando la barra llega al 100%:

1. **Pausa de 300ms** en `Sistema listo` con el texto brillando brevemente (opacity 1.0 → 0.6 → 1.0).
2. **El dron entra** desde el borde izquierdo de la pantalla (`translateX(-200px)`) a nivel del logo, con una trayectoria horizontal ligeramente ascendente (3° de inclinación CSS `rotate(-3deg)`). Es un SVG inline de ala fija vista lateral: fuselaje alargado, alas delta, sin ruedas, color blanco / gris claro.
3. **Velocidad de cruce:** 1.4 segundos para atravesar la pantalla completa de izquierda a derecha. Función `ease-in-out`.
4. **Cuando el dron alcanza el 60% de la pantalla** (tiempo ~0.85s), suelta una carga de agua: un grupo de 4-6 gotas SVG que caen en parábola hacia abajo con `@keyframes drop`, color azul cyan translúcido (`rgba(100, 200, 255, 0.8)`), se disuelven al llegar a la parte inferior.
5. **El dron sale** por el borde derecho.
6. **Fundido a negro:** 600ms `fadeOut` de toda la splash screen (`opacity: 1 → 0`, `transition`).
7. **Carga la pantalla de planificación:** `window.location.href = 'pages/planning/index.html'` cuando el fundido completa.

### 4.4 Código estructura splash.js

```javascript
// Secuencia de carga controlada
const LOADING_STEPS = [
  { pct: 20, msg: 'Inicializando sistema MAVLink...', delay: 400 },
  { pct: 45, msg: 'Cargando cartografía de Galicia...', delay: 900 },
  { pct: 70, msg: 'Generando modelos de terreno...', delay: 700 },
  { pct: 90, msg: 'Calibrando simulador de vuelo...', delay: 800 },
  { pct: 100, msg: 'Sistema listo', delay: 300 },
];
// Al llegar a 100% → triggerDroneAnimation() → fadeOut() → navigate()
```

### 4.5 NO hacer en la splash

- No usar canvas, WebGL ni librerías externas. Solo CSS + SVG inline + JS vanilla.
- No bloquear con fetch real al backend durante la carga. La barra es puramente estética.
- No usar imágenes externas. Todo el contenido gráfico es SVG inline o CSS.

---

## 5. Pantalla de Planificación

### 5.1 Layout

Pantalla dividida en dos columnas:

**Columna izquierda (380px fija):** Panel de control de misión  
**Columna derecha (flex, resto):** Mapa MapLibre 3D de Galicia

### 5.2 Panel izquierdo — secciones en orden vertical

**Header:**
- Logo pequeño (20px) + `GALICIA WILDFIRE` + badge de estado conexión backend (verde/rojo)

**Sección "Zona de operaciones":**
- 4 cards seleccionables, una por zona predefinida
- Al hover: preview thumbnail del terreno (imagen estática JPG)
- Al seleccionar: el mapa navega a esa zona con `flyTo`

Las 4 zonas y sus coordenadas de centro:

```javascript
const ZONES = {
  courel: {
    name: 'Serra do Courel',
    center: [-7.05, 42.60],
    zoom: 13,
    description: 'Bosque denso de robles y castaños. Pendientes pronunciadas.',
    area_km2: 18,
    difficulty: 'Alta',
  },
  eume: {
    name: 'Fragas do Eume',
    center: [-8.05, 43.40],
    zoom: 13,
    description: 'Bosque atlántico costero. Viento predominante del noroeste.',
    area_km2: 12,
    difficulty: 'Media',
  },
  suido: {
    name: 'Serra do Suído',
    center: [-8.27, 42.37],
    zoom: 13,
    description: 'Matorral y eucalipto. Propagación rápida en verano.',
    area_km2: 22,
    difficulty: 'Muy alta',
  },
  pindo: {
    name: 'Monte Pindo',
    center: [-9.07, 42.84],
    zoom: 13,
    description: 'Granito y pino costero. Relieve irregular.',
    area_km2: 9,
    difficulty: 'Media',
  },
};
```

**Sección "Base de operaciones":**
- Instrucción: `Haz clic en el mapa para colocar la base`
- Una vez colocada: muestra lat/lon + botón `Mover base`
- Ícono de base: marcador rojo con icono de helipuerto (H) en el mapa

**Sección "Condiciones meteorológicas":**
- Se genera al pulsar `GENERAR MISIÓN`
- Muestra: dirección del viento (rosa de los vientos animada CSS) + velocidad en km/h
- Muestra: número de focos generados (1-4, aleatorio)
- Color de alerta según velocidad: verde <20 km/h, naranja 20-40, rojo >40

**Botón principal:**
```
[ ▶  INICIAR MISIÓN ]
```
- Habilitado solo cuando zona + base están seleccionadas
- Al pulsar: llama `POST /api/game/new-game` → espera respuesta → navega al simulador

### 5.3 Mapa de planificación

- MapLibre GL JS con estilo base: `https://tiles.openfreemap.org/styles/liberty`
- Terreno 3D activado con exageración `1.5`
- Capa ortofoto PNOA como overlay opcional (botón toggle)
- El mapa centra en Galicia al inicio: `[-7.8, 42.7]`, zoom 9
- Al seleccionar zona: `flyTo` con `duration: 1800ms`, `pitch: 45`, `bearing: -15`
- Marcador de base: arrastrable, actualiza coordenadas en panel en tiempo real
- Al hover sobre el mapa: cursor crosshair cuando se espera colocar base

---

## 6. Pantalla del Simulador

### 6.1 Layout

Pantalla completa ocupada por el mapa 3D. Sobre él, overlays flotantes:

- **HUD superior izquierda:** velocidad, altitud AGL, heading
- **HUD superior derecha:** pitch, roll (indicador de horizonte artificial)
- **Panel inferior central:** modo de vuelo actual + estado dron (armed/disarmed) + botones de modo
- **Panel inferior derecho:** estado geofence (inactiva / grabando / cerrada) + contador de vértices
- **Panel superior derecho:** estado del viento (dirección + velocidad constante recordatorio)
- **Panel de enjambre (aparece tras cerrar geofence):** progreso de extinción por foco (barras)

### 6.2 Mapa del simulador

- Misma base que planificación pero centrado en la zona seleccionada
- `pitch: 45`, `bearing` dinámico siguiendo al dron en modo follow
- Terreno 3D con exageración `1.8` (más dramático en vuelo)
- Ortofoto PNOA activa por defecto en el simulador
- Marcador del dron: SVG inline de ala fija vista superior (planta), blanco con borde negro, rota por yaw, LED verde adelante parpadeante cuando armado

### 6.3 Capas GeoJSON del simulador

```
fire-base-layer        → Marcador base equipo (icono H rojo)
fire-heat-layer        → Polígonos de calor (fill rojo/naranja, opacity proporcional a intensidad)
fire-spread-layer      → Animación de expansión (partículas o GeoJSON actualizando cada 5s)
geofence-preview-layer → Línea de la geofence en construcción (azul cyan punteado)
geofence-closed-layer  → Polígono geofence cerrado (relleno azul 20% opacity, borde sólido)
swarm-routes-layer     → Líneas de pasadas del enjambre (blanco, dash-array animado)
swarm-drones-layer     → Iconos de drones cisterna animados moviéndose por las rutas
water-drop-layer       → Efecto visual de descarga de agua (círculos azules que aparecen/desaparecen)
```

---

## 7. Motor de Fuego

### 7.1 Generación de focos

`backend/game/fire_engine.py`

Al iniciar una misión (`POST /api/game/new-game`):

1. Se generan entre 1 y 4 focos de ignición. El número depende de la dificultad de la zona.
2. Cada foco tiene coordenadas aleatorias dentro del bounding box de la zona, alejadas al menos 800m entre sí y al menos 500m de la base del equipo.
3. Cada foco tiene: `{ id, lat, lon, intensity: 1.0, area_m2: 500, cells: [...] }`

### 7.2 Viento

`backend/game/wind.py`

```python
import random

def generate_wind():
    direction_deg = random.uniform(0, 360)   # norte = 0
    speed_kmh = random.uniform(8, 55)        # entre brisa suave y viento fuerte
    return { 'direction_deg': direction_deg, 'speed_kmh': speed_kmh }
```

El viento no cambia durante la misión una vez generado. Se envía al frontend en la respuesta de `new-game`.

### 7.3 Propagación

El terreno de la zona se discretiza en una rejilla hexagonal (o cuadrada simplificada) de celdas de 50×50 m. Cada celda tiene estado: `UNBURNED | BURNING | BURNED`.

Cada 10 segundos el backend calcula una iteración de propagación:
- Para cada celda `BURNING`, se evalúan sus vecinas `UNBURNED`
- La probabilidad de ignición de una vecina depende de: distancia al foco, componente del vector viento en la dirección del foco a vecina, factor aleatorio ±15%
- Las celdas que llevan >90s ardiendo pasan a `BURNED` (ya no propagan)

El backend emite el estado actualizado del fuego por WebSocket cada 5 segundos como evento `fire_update`:

```json
{
  "type": "fire_update",
  "fires": [
    {
      "id": "fire_1",
      "cells_burning": [[lat, lon], ...],
      "cells_burned": [[lat, lon], ...],
      "intensity": 0.87
    }
  ]
}
```

El frontend recibe este evento y actualiza las capas GeoJSON del mapa sin recargar nada más.

### 7.4 Extinción por el enjambre

Cuando un dron del enjambre completa una pasada sobre una celda, esa celda pasa a `EXTINGUISHED` (estado especial: no puede re-ignitar, se colorea gris azulado). El porcentaje de celdas extinguidas sobre el total del foco es el progreso de extinción mostrado en el panel de enjambre.

---

## 8. Control con Gamepad Xbox

`frontend/components/gamepad/gamepad.js`

### 8.1 Detección

```javascript
window.addEventListener('gamepadconnected', (e) => {
  console.log(`Gamepad conectado: ${e.gamepad.id}`);
  startPolling(e.gamepad.index);
});
```

### 8.2 Mapeo de ejes y botones (Xbox USB)

| Input físico | Índice API | Acción en simulador |
|---|---|---|
| Stick izquierdo X | `axes[0]` | Aileron (roll) — RC ch1 |
| Stick izquierdo Y | `axes[1]` | Elevator (pitch) — RC ch2 |
| Stick derecho X | `axes[2]` | Rudder (yaw) — RC ch4 |
| Stick derecho Y | `axes[3]` | (no usado en ala fija) |
| L2 (gatillo izq) | `axes[4]` (0→1) | Reducir throttle — RC ch3 |
| R2 (gatillo dcho) | `axes[5]` (0→1) | Aumentar throttle — RC ch3 |
| R1 (bumper dcho) | `buttons[5]` | Añadir vértice geofence |
| L1 (bumper izq) | `buttons[4]` | Cerrar geofence |
| Botón A | `buttons[0]` | ARM / DISARM toggle |
| Botón B | `buttons[1]` | Modo FBWA (Fly By Wire A) |
| Botón X | `buttons[2]` | Modo CRUISE |
| Botón Y | `buttons[3]` | RTL (Return To Launch) |
| START | `buttons[9]` | Pausa / menú |

### 8.3 Throttle combinado L2 + R2

El throttle de ArduPlane se controla como RC ch3 (1000–2000 µs). La lógica:

```javascript
// L2 y R2 van de 0.0 (sin pulsar) a 1.0 (fondo)
const throttleIncrease = (axes[5] + 1) / 2;   // R2: 0→1
const throttleDecrease = (axes[4] + 1) / 2;   // L2: 0→1
const delta = (throttleIncrease - throttleDecrease) * 500; // ±500
rcChannels.throttle = clamp(rcChannels.throttle + delta * dt, 1000, 2000);
```

### 8.4 Deadzone y suavizado

- Deadzone: ±0.08 en todos los ejes (ignorar movimientos involuntarios)
- Suavizado: `smoothedValue = prev * 0.7 + raw * 0.3` (filtro paso bajo)
- Frecuencia de polling: 50Hz (`setInterval(poll, 20)`)
- RC override se envía solo si hay cambio significativo (>15 µs en algún canal)

### 8.5 Modo sin gamepad

Si no hay gamepad conectado, el simulador muestra un banner amarillo: `Gamepad no detectado — conecta un mando Xbox por USB`. El control por teclado sigue disponible como fallback (WASD + flechas + espacio = ARM, mismas teclas que proyecto anterior).

---

## 9. Dibujo de Geofences en Vuelo

`frontend/components/geofence/geofence_draw.js`

### 9.1 Flujo de interacción

```
Estado: INACTIVE
  → Pulsar R1 (primer vértice) → Estado: RECORDING
  → Pulsar R1 en vuelo → añade vértice en posición GPS actual del dron
  → [3 vértices mínimo para un polígono válido]
  → Pulsar L1 → Estado: CLOSED → polígono se cierra automáticamente
  → Backend calcula pasadas del enjambre para ese polígono
  → Estado: INACTIVE (listo para siguiente foco si hay más)
```

### 9.2 Feedback visual durante grabación

- Panel HUD muestra `● REC GEOFENCE` en rojo parpadeante cuando estado = RECORDING
- Líneas cyan punteadas conectan los vértices capturados en tiempo real
- Cada vértice marcado con un círculo pequeño blanco en el mapa
- Al cerrar (L1): el polígono se rellena con azul translúcido y el borde se vuelve sólido
- Toast de confirmación: `Geofence #1 capturada — X vértices — Y hectáreas`

### 9.3 Validaciones

- Mínimo 3 vértices para aceptar el cierre con L1
- Si se pulsa L1 con menos de 3 vértices: toast de error, estado sigue RECORDING
- Máximo 20 vértices por geofence (simplicidad de cálculo del enjambre)
- Si el polígono se auto-intersecta: warning visual (borde rojo) pero se acepta

### 9.4 API

```javascript
// geofence_draw.js
class GeofenceDraw {
  constructor(map, telemetryBus) { ... }
  startRecording() { this.state = 'RECORDING'; this.vertices = []; }
  addVertex(lat, lon) { this.vertices.push([lon, lat]); this._updatePreview(); }
  closeGeofence() {
    if (this.vertices.length < 3) return false;
    this.state = 'CLOSED';
    this._renderClosedPolygon();
    return { type: 'Polygon', coordinates: [...this.vertices, this.vertices[0]] };
  }
}
```

---

## 10. Motor del Enjambre

`backend/game/swarm.py`

### 10.1 Cálculo de pasadas (boustrophedon)

Dado un polígono GeoJSON de geofence:

1. Calcular el bounding box del polígono
2. Calcular la dirección perpendicular al viento (las pasadas van en la dirección que maximiza la cobertura contra el viento)
3. Generar líneas paralelas separadas `SWATH_WIDTH = 80` metros que crucen el bounding box
4. Recortar cada línea al interior del polígono (intersección geométrica)
5. Ordenar las líneas en patrón de ida y vuelta (boustrophedon)
6. El resultado es una lista de segmentos de ruta ordenados

### 10.2 Número de drones del enjambre

```python
SWARM_SIZE_BY_AREA = {
    range(0, 5):      2,   # <5 ha → 2 drones
    range(5, 20):     4,   # 5-20 ha → 4 drones
    range(20, 50):    6,   # 20-50 ha → 6 drones
    range(50, 9999):  8,   # >50 ha → 8 drones
}
```

### 10.3 Simulación de vuelo del enjambre

El enjambre no usa SITL. Es una simulación matemática en backend:

- Cada dron tiene: posición actual, ruta asignada (subset de pasadas), velocidad `25 m/s`, capacidad de agua `200 L`, tasa de descarga `2 L/s`
- El backend emite `swarm_update` por WebSocket cada 2 segundos con posiciones de todos los drones
- Cuando un dron termina su carga de agua, "regresa a la base" (animación), "recarga" (3s fijo), y vuelve a la siguiente pasada
- El frontend anima los iconos de dron a lo largo de las rutas con interpolación lineal

### 10.4 Endpoint de inicio del enjambre

```
POST /api/game/launch-swarm
Body: { geofence_id: "fire_1", polygon: GeoJSON }
Response: {
  swarm_id: "sw_1",
  drones: [...],
  routes: [...],
  estimated_duration_s: 420
}
```

---

## 11. Backend — Endpoints REST

```
GET  /health                           → Estado del sistema y conexión MAVLink
GET  /api/game/zones                   → Lista de zonas disponibles con metadatos
POST /api/game/new-game                → Genera misión: wind + fires + returns game_state
POST /api/game/launch-swarm            → Lanza enjambre para una geofence dada
POST /api/mission/upload               → Sube misión waypoints a ArduPlane SITL
GET  /api/mission/download             → Descarga misión actual de ArduPlane
POST /api/control/arm                  → Armar/desarmar dron
POST /api/control/mode                 → Cambiar modo de vuelo
POST /api/simulation/restart-at        → Reinicia SITL con nuevo home (lat, lon, alt)
```

### 11.1 WebSocket /ws/telemetry

Emite a 10Hz los datos de vuelo del dron pilotado:

```json
{
  "type": "telemetry",
  "lat": 42.601,
  "lon": -7.052,
  "alt_agl": 85.3,
  "alt_msl": 1204.7,
  "speed_ms": 18.4,
  "heading": 247,
  "pitch": -2.1,
  "roll": 8.7,
  "armed": true,
  "mode": "FBWA",
  "throttle_pct": 68
}
```

También emite eventos del juego con `type: "fire_update"` y `type: "swarm_update"` por el mismo socket.

### 11.2 WebSocket /ws/control

Recibe del frontend:

```json
{ "type": "rc_override", "ch1": 1520, "ch2": 1480, "ch3": 1650, "ch4": 1500 }
{ "type": "set_mode", "mode": "FBWA" }
{ "type": "arm", "arm": true }
```

---

## 12. Modos de Vuelo (ArduPlane)

Los modos relevantes para este proyecto con ala fija:

| Modo | Descripción | Cuándo usarlo |
|------|-------------|---------------|
| FBWA | Fly By Wire A — estabilizado, el piloto controla actitud | Vuelo de reconocimiento normal |
| CRUISE | Mantiene altitud y rumbo, correcciones suaves | Vuelo largo sobre la zona |
| LOITER | Círculos automáticos alrededor de un punto | Inspeccionar un foco |
| AUTO | Sigue waypoints automáticamente | Opcional: ruta de despegue |
| RTL | Return To Launch | Fin de misión o emergencia |
| MANUAL | Sin estabilización — solo usuarios expertos | Desactivado en la UI |

El botón A del mando hace ARM/DISARM. Los botones B, X, Y cambian a FBWA, CRUISE, RTL respectivamente. El panel inferior del simulador tiene los mismos botones en pantalla como alternativa.

---

## 13. HUD (Heads-Up Display)

`frontend/components/hud/hud.js`

El HUD es CSS puro posicionado en `position: absolute` sobre el mapa. Sin canvas.

### 13.1 Panel superior izquierdo

```
┌─────────────────────────┐
│  IAS   184 km/h         │
│  ALT   847 m AGL        │
│  HDG   247°             │
└─────────────────────────┘
```

- Fondo: `rgba(0, 0, 0, 0.55)`, blur backdrop opcional
- Texto: verde fosforescente `#00ff88`, monoespaciado, 16px
- Actualizacion: cada telemetría recibida

### 13.2 Indicador de actitud (superior derecho)

Horizon artificial simplificado CSS:
- Círculo de 90px de diámetro
- Mitad superior azul (cielo) / mitad inferior marrón (tierra)
- La línea del horizonte rota con `roll` y se desplaza verticalmente con `pitch`
- Implementado con CSS `clip-path` rotado por JS

### 13.3 Badge de modo (inferior central)

```
[ ● FBWA ] [ ARM ]
```
Colores del badge de modo:
- FBWA / CRUISE → verde `#1a7a1a`
- LOITER → azul `#1a5a9a`
- RTL / AUTO → naranja `#9a5a00`
- MANUAL → rojo `#9a1a1a`

### 13.4 Indicador de geofence (inferior derecho)

```
GEOFENCE: INACTIVA
● REC — 5 vértices       ← cuando graba
✓ CERRADA — 2.4 ha       ← cuando cerrada
```

---

## 14. Diseño Visual General

### 14.1 Paleta de colores

```css
:root {
  --color-bg:           #0a0a0a;     /* negro base */
  --color-surface:      #141414;     /* superficies de panel */
  --color-surface-2:    #1e1e1e;     /* hover, bordes */
  --color-accent-fire:  #e85d24;     /* naranja fuego — CTA principal */
  --color-accent-fire2: #f2a623;     /* amarillo llama */
  --color-accent-water: #3bb8e0;     /* azul agua — enjambre */
  --color-accent-geo:   #00bfff;     /* cyan — geofence */
  --color-text-primary: #f0ece4;     /* blanco cálido */
  --color-text-muted:   #888880;     /* gris apagado */
  --color-success:      #2da862;
  --color-danger:       #c0392b;
  --color-warning:      #e8a020;
  --color-hud-green:    #00ff88;     /* verde HUD clásico */
}
```

### 14.2 Tipografía

- UI general: `'Inter', system-ui, sans-serif` (CDN Google Fonts o local)
- HUD y datos técnicos: `'JetBrains Mono', 'Courier New', monospace`
- Títulos splash: `'Inter', sans-serif` con `font-weight: 700, letter-spacing: 0.15em`

### 14.3 Paneles flotantes

Todos los paneles del simulador siguen el mismo patrón:
```css
.hud-panel {
  background: rgba(10, 10, 10, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  backdrop-filter: blur(8px);
  padding: 10px 14px;
  font-family: var(--font-mono);
  color: var(--color-text-primary);
}
```

### 14.4 Animaciones

- Todas las transiciones de estado: `transition: all 0.2s ease`
- Parpadeos de alerta: `@keyframes` con `animation-timing-function: ease-in-out`
- No usar `transition: all` en elementos con posición absoluta animada (rendimiento)
- El fuego en el mapa: opacidad pulsante `0.6 → 0.9 → 0.6` cada 2 segundos

---

## 15. Configuración SITL ArduPlane

### 15.1 Parámetros de inicio

`backend/simulation/sitl_manager.py` arranca ArduPlane en WSL2:

```bash
cd ~/ardupilot
python3 Tools/autotest/sim_vehicle.py \
  --vehicle=ArduPlane \
  --custom-location={lat},{lon},{alt_msl},0 \
  --out=udp:127.0.0.1:14550 \
  --no-mavproxy
```

La altitud MSL del home se calcula consultando OpenTopoData para las coordenadas de la zona seleccionada antes de arrancar el SITL.

### 15.2 Parámetros MAVLink relevantes para ArduPlane SITL

Configurar al conectar:
```python
# Activar FBWA como modo por defecto
mav.mav.param_set_send(target_system, target_component,
    b'FLTMODE1', 11, mavutil.mavlink.MAV_PARAM_TYPE_INT8)  # 11 = FBWA

# RC calibration para que RC override funcione
mav.mav.param_set_send(..., b'ARSPD_USE', 0, ...)  # Sin airspeed sensor en SITL
```

### 15.3 Diferencias con ArduCopter (proyecto anterior)

| Característica | ArduCopter | ArduPlane (este proyecto) |
|---|---|---|
| Modo estabilizado | LOITER (hovea) | FBWA (necesita velocidad mínima) |
| Throttle neutro | 1500 (mid-stick) | 1000 = ralentí, 1800 = crucero |
| ARM sin despegue | Sí (en LOITER) | Requiere suficiente velocidad (en SITL se puede armar en cualquier modo) |
| RTL | Sube y vuelve hovea | Vuelve describiendo una curva y aterriza |
| RC ch3 (throttle) | Spring-back a 1500 | Retiene posición (no spring-back) |

---

## 16. Sistema de Puntuación y Debrief

Al terminar la misión (todos los focos extinguidos o tiempo límite):

```
┌──────────────────────────────────────────────┐
│         MISIÓN COMPLETADA                    │
│  Zona: Serra do Courel                       │
│  Tiempo: 18:42                               │
│  Focos detectados: 3 / 3           ★★★      │
│  Área geofenced: 94% del total     ★★☆      │
│  Extinción lograda: 87%            ★★☆      │
│  Drones perdidos: 0                ★★★      │
│  PUNTUACIÓN TOTAL: 8.400 pts                 │
│                                              │
│  [ Nueva misión ]  [ Menú principal ]        │
└──────────────────────────────────────────────┘
```

El debrief aparece como modal overlay con `backdrop-filter: blur(12px)`.

---

## 17. Archivos de Configuración

### 17.1 `backend/.env`

```env
MAVLINK_HOST=127.0.0.1
MAVLINK_PORT=14550
MAVLINK_BAUD=115200
SITL_MODE=external          # external | managed
WSL_DISTRO=Ubuntu
FRONTEND_URL=http://localhost:3000
MONGODB_URI=mongodb://gw_admin:gw_pass@localhost:27017/galicia_wildfire?authSource=admin
WS_BRIDGE_TCP_PORT=14555
WS_BRIDGE_WS_PORT=8765
```

### 17.2 `frontend/config.js`

```javascript
window.APP_CONFIG = {
  API_URL: `http://${window.location.hostname}:8000`,
  WS_TELEMETRY: `ws://${window.location.hostname}:8765`,   // ws_bridge (real-time)
  WS_CONTROL:   `ws://${window.location.hostname}:8765`,   // ws_bridge (RC override)
  TERRAIN_TILE_URL: 'https://api.maptiler.com/tiles/terrain-rgb/{z}/{x}/{y}.png?key=YOUR_KEY',
  PNOA_WMS_URL: 'https://www.ign.es/wms-inspire/pnoa-ma',
  OPENFREEMAP_STYLE: 'https://tiles.openfreemap.com/styles/liberty',
};
```

**Nota:** MapTiler tiene capa gratuita (75.000 tiles/mes). Para desarrollo, OpenTopoData SRTM es válido como fallback.

### 17.3 `start.bat`

```batch
@echo off
echo Iniciando Galicia Wildfire...

set PYTHON=python
where python >nul 2>&1 || set PYTHON=%LOCALAPPDATA%\Programs\Python\Python311\python.exe

echo [1/2] Iniciando backend...
start "GW-Backend" cmd /k "cd backend && %PYTHON% -m uvicorn main:app --reload --port 8000"

echo [2/2] Iniciando frontend...
start "GW-Frontend" cmd /k "cd frontend && %PYTHON% -m http.server 3000"

timeout /t 2
start http://localhost:3000
```

---

## 18. Decisiones de Arquitectura (NO CAMBIAR)

| Decisión | Tecnología elegida | Razón |
|---|---|---|
| SITL | ArduPlane (ala fija) | El proyecto requiere dron de ala fija por realismo operativo |
| Enjambre | Simulación matemática | Múltiples SITL reales son inviables en hardware estándar |
| Mapa | MapLibre GL JS 4.7.1 | Gratuito, terreno 3D nativo, sin token obligatorio |
| Terreno | PNOA + OpenTopoData | Datos reales de Galicia, software libre |
| Gamepad | Gamepad API nativa | Sin librerías externas, soporte universal Xbox |
| Fuego | Autómata celular backend | Lógica centralizada, fácil de ajustar, sin estado en cliente |
| Geofence | Captura por vértices en vuelo | Compatible con ala fija, realista operativamente |
| Swarm path | Boustrophedon perpendicular al viento | Maximiza cobertura, simple de calcular |
| Backend | FastAPI async | WebSocket + REST en un proceso, misma arquitectura del proyecto anterior |
| Splash | CSS + SVG inline puro | Sin dependencias, carga instantánea |

---

## 21. Arquitectura Completa del Sistema (Diagrama de capas)

> Revisado 2026-05-04 — Constraints ejercicio F + decisión Option B (ws_bridge directo)

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND HMI                              │
│   HTML/CSS/JS Vanilla  ·  MapLibre GL JS  ·  Gamepad API (Xbox) │
│                                                                  │
│  WS:8765 ◄─── telemetría JSON ─── ws_bridge                     │
│  WS:8765 ───► gamepad binario  ──► ws_bridge  (path rápido)     │
│                                                                  │
│  HTTP:8000 ──► REST endpoints  ──► FastAPI    (path lento)      │
└──────────────────────────────────────────────────────────────────┘
         │ WS:8765 (real-time)            │ HTTP:8000 (eventos)
         ▼                                ▼
┌─────────────────────┐        ┌─────────────────────────────────┐
│    ws_bridge.py     │        │         FastAPI (Python)        │
│  (Windows, :8765)   │        │   REST: fleet, game, health,    │
│                     │        │   ARM, modos, misión, SITL      │
│  TCP server :14555  │        │   Motor (async) → MongoDB       │
│  ◄──► MAVProxy      │        └──────────────┬──────────────────┘
│  WS server :8765    │                        │ pymavlink UDP:14550
│  ◄──► HMI browser   │                        ▼
└──────────┬──────────┘        ┌─────────────────────────────────┐
           │ tcpout bidirec.   │         MongoDB (Docker)        │
           │ TCP:14555         │   drones · missions ·           │
           ▼                   │   telemetry_logs                │
┌──────────────────────┐       └─────────────────────────────────┘
│      MAVProxy        │
│      (WSL2)          │
│  --master tcp:5760   │
│  --out udp:WIN:14550 │ ◄─── FastAPI pymavlink (ARM, modos, etc.)
│  --out tcpout:WIN:   │
│         14555        │ ◄──► ws_bridge (telemetría + RC override)
└──────────┬───────────┘
           │ TCP:5760
┌──────────▼───────────┐
│   ArduPlane SITL     │
│   (WSL2 headless)    │
│   TCP:5760           │
└──────────────────────┘
```

### 21.1 Path rápido — telemetría y control RC (ws_bridge, ~2–5ms extra vs. FastAPI)

| Paso | Componente | Protocolo | Latencia estimada |
|------|-----------|-----------|------------------|
| 1 | ArduPlane emite MAVLink | TCP:5760 | ~0ms |
| 2 | MAVProxy reenvía por tcpout | TCP:14555 | ~1ms |
| 3 | ws_bridge parsea MAVLink binario | in-process | ~0.5ms |
| 4 | ws_bridge hace broadcast JSON | WS:8765 | ~1ms |
| 5 | HMI actualiza HUD | DOM | ~2ms |
| — | **Total telemetría** | — | **~4–5ms** |
| A | HMI lee Gamepad API | JS 50Hz | ~0–20ms |
| B | ws_bridge recibe binario 9B | WS:8765 | ~1ms |
| C | ws_bridge envía RC_OVERRIDE MAVLink | TCP:14555 | ~1ms |
| D | MAVProxy reenvía a ArduPlane | TCP:5760 | ~1ms |
| — | **Total control** | — | **~3–23ms** |

### 21.2 Path lento — comandos discretos (FastAPI REST)

| Acción | Endpoint | Nota |
|--------|---------|------|
| ARM / DISARM | POST /api/control/arm | Via pymavlink UDP:14550 |
| Cambio de modo | POST /api/control/mode | Via pymavlink UDP:14550 |
| Iniciar misión | POST /api/simulation/restart-at | Lanza SITL + configura coords |
| Subir waypoints | POST /api/simulation/upload-mission | MAVLink MISSION_ITEM |
| Fleet drones | GET/PUT /api/fleet/\* | Motor → MongoDB |

### 21.3 Fuentes de delay identificadas (para auditoría futura)

| ID | Punto | Tipo | Impacto | Mitigation |
|----|-------|------|---------|-----------|
| D-01 | Gamepad API poll rate | Hardware | 20ms fijo | No reducible; usar rAF |
| D-02 | JSON serialize/deserialize | CPU | 0.5–2ms | **Eliminado con binario 9B** |
| D-03 | FastAPI async overhead | SW | 2–8ms | **Eliminado con ws_bridge** |
| D-04 | WebSocket frame buffering | Network | 0–5ms | Mensajes pequeños ayudan |
| D-05 | MAVProxy TCP→forward | SW | 5–15ms | Aceptable, no reducible |
| D-06 | ArduPlane SITL sim tick | HW/SW | 20ms (50Hz sim) | speedup=1 necesario |
| D-07 | MongoDB query (fleet) | DB | 1–10ms | Solo path lento, OK |

---

## 22. Docker — Base de Datos MongoDB de Flota y Telemetría

> Revisado 2026-05-04 — MongoDB reemplaza PostgreSQL (mejor para telemetría post-misión + esquema flexible)

### 22.1 Servicios Docker

```yaml
# docker-compose.yml (raíz del proyecto)
services:
  mongodb:
    image: mongo:7
    container_name: gw-mongo
    environment:
      MONGO_INITDB_ROOT_USERNAME: gw_admin
      MONGO_INITDB_ROOT_PASSWORD: gw_pass
      MONGO_INITDB_DATABASE: galicia_wildfire
    ports:
      - "27017:27017"
    volumes:
      - gw_mongodata:/data/db

volumes:
  gw_mongodata:
```

Solo la base de datos corre en Docker. Backend y frontend se lanzan con `start.bat`.
**Backend NO va en Docker** — necesita invocar `wsl -d Ubuntu bash -lc ...` para SITL.

### 22.2 Colecciones MongoDB

**Colección `drones`** — flota, estado, historial de vuelo:
```json
{
  "_id": ObjectId,
  "call_sign": "GW-RECCO-01",
  "type": "reconnaissance",        // "reconnaissance" | "tanker"
  "status": "available",           // "available" | "on_mission" | "maintenance" | "retired"
  "flight_hours": 12.5,
  "last_mission_id": ObjectId,
  "notes": "",
  "created_at": ISODate
}
```

**Colección `missions`** — registro por misión:
```json
{
  "_id": ObjectId,
  "zone": "serra_courel",
  "drone_id": ObjectId,
  "started_at": ISODate,
  "ended_at": ISODate,
  "score": 8400,
  "fires_detected": 3,
  "fires_extinguished": 3,
  "geofence_coverage_pct": 94.0,
  "drones_lost": 0,
  "wind_speed": 12,
  "wind_dir": 270
}
```

**Colección `telemetry_logs`** — datos post-misión (grabados durante la misión, guardados al terminar):
```json
{
  "_id": ObjectId,
  "mission_id": ObjectId,
  "ts": 1746400000.123,
  "lat": 42.6, "lon": -7.05,
  "alt_rel": 80.0,
  "roll": 8.2, "pitch": 1.5, "yaw": 270.0,
  "airspeed": 22.0,
  "throttle_pct": 65,
  "mode": "CRUISE"
}
```

Drones iniciales se insertan desde `backend/db/mongo_init.py` al arrancar si la colección está vacía.

### 22.3 Dependencias Python

```
motor==3.4.0          # driver async MongoDB para FastAPI
pymongo==4.7.0        # motor lo requiere como dep
```

Añadir a `backend/requirements.txt`. Eliminar `asyncpg`, `psycopg2-binary`.

### 22.4 Endpoints REST de flota

```
GET  /api/fleet/drones              → Lista todos los drones con su estado
GET  /api/fleet/drones/available    → Solo drones disponibles
PUT  /api/fleet/drones/{id}/status  → Actualizar estado
GET  /api/fleet/missions            → Historial de misiones
POST /api/fleet/missions            → Crear registro nueva misión
PUT  /api/fleet/missions/{id}/end   → Cerrar misión con score y estadísticas
POST /api/fleet/missions/{id}/telemetry → Guardar batch de telemetría post-misión
```

### 22.5 Integración con el flujo existente

- Al **INICIAR MISIÓN**: `POST /api/fleet/missions` → crea documento misión + marca drone `on_mission`
- Durante la misión: frontend acumula telemetría en memoria (buffer JS circular 10 min)
- Al **terminar misión** (debrief): `PUT /api/fleet/missions/{id}/end` + `POST telemetry` (batch) + drone → `available`
- En planning: `GET /api/fleet/drones/available` → badge de drones disponibles
```

### 22.3 Nuevas dependencias Python

```
asyncpg==0.29.0        # driver async PostgreSQL para FastAPI
psycopg2-binary==2.9.9 # fallback síncrono si se necesita
```

Añadir a `backend/requirements.txt`.

### 22.4 Nuevos endpoints REST de flota

```
GET  /api/fleet/drones              → Lista todos los drones con su estado
GET  /api/fleet/drones/available    → Solo drones disponibles (status='available')
PUT  /api/fleet/drones/{id}/status  → Actualizar estado (available|maintenance|on_mission)
GET  /api/fleet/missions            → Historial de misiones
POST /api/fleet/missions            → Crear registro de nueva misión
PUT  /api/fleet/missions/{id}/end   → Cerrar misión con score y estadísticas
```

### 22.5 Integración con el flujo existente

- Al pulsar **INICIAR MISIÓN** en planning: `POST /api/fleet/missions` crea el registro, asocia `GW-RECCO-01` como `on_mission`
- Al terminar misión (debrief): `PUT /api/fleet/missions/{id}/end` guarda score + `PUT /api/fleet/drones/1/status` → `available`
- En la pantalla de planning mostrar badge de drones disponibles: `GET /api/fleet/drones/available`

### 22.6 Archivos nuevos a crear

```
backend/
├── db/
│   └── init.sql              ← Schema y datos iniciales
├── api/routes/
│   └── fleet.py              ← Endpoints /api/fleet/*
docker-compose.yml            ← En raíz del proyecto
```

---

## 23. Optimización de Latencia del Gamepad

> Revisado 2026-05-04 — Constraint: "eliminar el lag del mando". Solución: ws_bridge elimina FastAPI del path crítico + binario 9B.

### 23.1 Diagnóstico del lag — antes vs. después

**Antes (FastAPI en el path):**
```
Gamepad API (20ms) → JSON serialize (~80B) → WebSocket → FastAPI async → pymavlink UDP → MAVProxy → ArduPlane
Total estimado: 30–50ms
```

**Después (ws_bridge directo):**
```
Gamepad API (20ms) → binario 9B → WebSocket:8765 → ws_bridge TCP:14555 → MAVProxy → ArduPlane
Total estimado: 22–27ms
```

Reducción: ~20–25ms menos por frame de control.

### 23.2 Formato binario compacto (implementado en ws_bridge)

Paquete de 9 bytes: 4 canales RC uint16 + 1 byte flags.

```javascript
// gamepad.js — encode RC override
function encodeRC(ch1, ch2, ch3, ch4, flags = 0x01) {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint16(0, ch1, true);   // little-endian
  view.setUint16(2, ch2, true);
  view.setUint16(4, ch3, true);
  view.setUint16(6, ch4, true);
  view.setUint8(8, flags);         // 0x01 = rc_override
  return buf;
}
ws.send(encodeRC(ch1, ch2, ch3, ch4));
```

```python
# ws_bridge.py — decode binario
import struct

if isinstance(data, (bytes, bytearray)) and len(data) == 9:
    ch1, ch2, ch3, ch4, flags = struct.unpack_from('<4HB', data)
    if flags == 0x01:
        _send_rc_override(mav_conn, ch1, ch2, ch3, ch4)
```

**Reducción de payload**: ~80-120 bytes JSON → **9 bytes binario** (~93% menos).

### 23.3 Throttle adaptativo (implementado en gamepad.js)

Solo enviar cuando canal cambia > umbral O ha pasado keepalive:

```javascript
const SEND_THRESHOLD = 15;      // µs
const KEEPALIVE_MS = 100;       // forzar envío cada 100ms aunque no haya cambio

let lastSentTs = 0;
const now = performance.now();
const hasChange = Math.abs(ch1 - prev.ch1) > SEND_THRESHOLD || ...;
if (hasChange || (now - lastSentTs) > KEEPALIVE_MS) {
  ctrlWs.send(encodeRC(ch1, ch2, ch3, ch4));
  lastSentTs = now;
}
```

### 23.4 Solución C (futura) — Eliminar MAVProxy del path de control

MAVProxy añade un salto extra. Si con ws_bridge + binario el lag sigue siendo perceptible, ws_bridge podría conectarse directamente a ArduPlane TCP:5760 solo para RC_CHANNELS_OVERRIDE, usando MAVProxy solo para telemetría recibida.

> ⚠️ Valorar solo si A+B no son suficientes. Requiere segunda conexión pymavlink TCP desde ws_bridge.

---

## 24. ws_bridge.py — Especificación Técnica

> Añadido 2026-05-04 — Nuevo componente de la arquitectura Option B

### 24.1 Responsabilidades

- Actúa como servidor TCP (puerto 14555) al que MAVProxy se conecta con `--out tcpout:WINDOWS_IP:14555`
- Actúa como servidor WebSocket (puerto 8765) al que el frontend HMI se conecta directamente
- **Telemetría**: recibe MAVLink binario del TCP, parsea ATTITUDE/GPS/HEARTBEAT/VFR_HUD, emite JSON a todos los clientes WS
- **Control RC**: recibe binario 9B del WS, decodifica canales RC, envía RC_CHANNELS_OVERRIDE MAVLink al TCP

### 24.2 Archivo: `backend/ws_bridge/ws_bridge.py`

```
backend/
├── ws_bridge/
│   ├── __init__.py
│   └── ws_bridge.py     ← proceso independiente, NO importado por FastAPI
```

Se lanza como proceso separado: `py -m backend.ws_bridge.ws_bridge` (o directo: `py backend/ws_bridge/ws_bridge.py`)

### 24.3 Threading model

ws_bridge usa dos hilos + asyncio para integrar pymavlink (sync) con websockets (async):

```
Thread MAVLink (sync):
  - mavutil.mavlink_connection('tcpin:0.0.0.0:14555')
  - Loop: recv_msg() → telem_queue.put()
         cmd_queue.get() → send MAVLink

Hilo principal (asyncio):
  - websockets.serve() → WS server :8765
  - broadcast_loop(): telem_queue.get() → json.dumps() → ws.send()
  - handle_ws(): ws.recv() → cmd_queue.put()
```

### 24.4 Formato JSON telemetría hacia HMI

Idéntico al existente en `/ws/telemetry` de FastAPI (compatibilidad con `telemetry.js` existente):
```json
{
  "type": "telemetry",
  "data": { "ts": ..., "lat": ..., "lon": ..., "alt_rel": ...,
            "roll": ..., "pitch": ..., "yaw": ...,
            "airspeed": ..., "groundspeed": ...,
            "mode": "CRUISE", "armed": true, ... }
}
```

### 24.5 Puertos y configuración

| Puerto | Protocolo | Dirección | Propósito |
|--------|-----------|-----------|---------|
| 14555 | TCP | Entrada (server) | MAVProxy `tcpout` → ws_bridge |
| 8765 | WebSocket | Entrada (server) | HMI browser → ws_bridge |
| 14550 | UDP | Entrada (FastAPI) | MAVProxy → pymavlink FastAPI |
| 8000 | HTTP | Entrada (FastAPI) | REST API |

### 24.6 Variables de entorno

```env
WS_BRIDGE_TCP_PORT=14555       # TCP server para MAVProxy
WS_BRIDGE_WS_PORT=8765         # WebSocket server para HMI
```

### 24.7 Puntos de fallo potenciales

| ID | Fallo | Síntoma | Solución |
|----|-------|---------|---------|
| F-01 | MAVProxy no conecta al TCP server | ws_bridge arrancado pero sin telemetría | Verificar IP Windows en MAVProxy cmd |
| F-02 | HMI conecta antes de SITL listo | WS conecta pero no llegan datos | Mostrar "esperando telemetría" |
| F-03 | TCP server ya en uso (:14555) | ws_bridge crash al arrancar | Verificar que no haya instancia previa |
| F-04 | pymavlink recv_msg bloqueante | Thread MAVLink bloquea si no hay datos | timeout en recv_msg o nonblocking=True |

## 19. Orden de Desarrollo Recomendado

1. **Fase 1 — Base del proyecto:** Estructura de carpetas + `start.bat` + `backend/main.py` + `/health` endpoint + `frontend/config.js`
2. **Fase 2 — Splash screen:** `splash.html` + CSS + animación dron completa
3. **Fase 3 — Pantalla de planificación:** MapLibre + zona picker + colocación de base + `POST /api/game/new-game`
4. **Fase 4 — SITL ArduPlane:** `sitl_manager.py` + `connection.py` + `telemetry.py` + WebSocket telemetría
5. **Fase 5 — Simulador base:** Mapa 3D zona + marcador dron + HUD + Gamepad API + RC override
6. **Fase 6 — Motor de fuego:** `fire_engine.py` + `wind.py` + capas GeoJSON fuego en mapa
7. **Fase 7 — Geofence:** `geofence_draw.js` + integración con botones R1/L1 del gamepad
8. **Fase 8 — Enjambre:** `swarm.py` + `swarm_renderer.js` + animación completa
9. **Fase 9 — Puntuación y debrief:** Modal de resultados + cálculo de score
10. **Fase 10 — Polish:** Sonidos, efectos visuales adicionales, ajuste de dificultad

---

## 20. Contexto de Referencia

Este proyecto reutiliza arquitectura del **Drone Simulator** anterior (proyecto académico), que ya tiene resueltos:
- Thread-safety de PyMAVLink (`asyncio.Lock` en `_read_loop`)
- Broadcaster privado por cliente en WebSocket telemetría
- `sitl_manager.py` con home dinámico (`restart-at`)
- Mapeo de modos de vuelo a colores en HUD
- RC override condicionado por modo (no enviar en AUTO/RTL)
- Config dinámica por hostname para compartir en LAN

Al desarrollar, si aparecen problemas de telemetría congelada, consultar los fixes S5-1 a S5-6 del proyecto anterior. Si hay problemas con ArduPlane SITL que no aparecían en ArduCopter, la diferencia clave es que el ala fija necesita velocidad mínima para responder a superficies de control.
