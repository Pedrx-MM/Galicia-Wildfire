# GALICIA WILDFIRE — Diario de Desarrollo

> Trazabilidad completa del proyecto: fases implementadas, bugs encontrados y sus soluciones.  
> Actualizar este archivo al cerrar cada sesión de desarrollo.

---

## Índice

1. [Estado general de fases](#1-estado-general-de-fases)
2. [Fase 1 — Base del proyecto](#2-fase-1--base-del-proyecto)
3. [Fase 2 — Splash screen](#3-fase-2--splash-screen)
4. [Registro de bugs y soluciones](#4-registro-de-bugs-y-soluciones)
5. [Iteraciones y mejoras post-implementación](#5-iteraciones-y-mejoras-post-implementación)
6. [Decisiones de arquitectura aplicadas](#6-decisiones-de-arquitectura-aplicadas)
7. [Pendiente](#7-pendiente)
8. [Fase 3 — Pantalla de planificación](#8-fase-3--pantalla-de-planificación)
9. [Fase 4 — SITL ArduPlane + MAVLink + WebSocket](#9-fase-4--sitl-arduplane--mavlink--websocket)
10. [Fase 5 — Simulador base](#10-fase-5--simulador-base)
11. [Constraints ejercicio F (2026-05-04)](#11-nuevas-constraints--ejercicio-f-2026-05-04)
12. [Arquitectura revisada — ws_bridge + MongoDB (2026-05-04)](#12-arquitectura-revisada--ws_bridge--mongodb-2026-05-04)
13. [WS split + MongoDB debrief + Fleet badge (2026-05-04)](#13-sesión-2026-05-04-continuación--ws-split--mongodb-debrief--fleet-badge)
14. [Fase 10 — Polish (2026-05-04)](#14-fase-10--polish-2026-05-04)

---

## 1. Estado general de fases

| Fase | Descripción | Estado | Sesión |
|------|-------------|--------|--------|
| 1 | Base del proyecto (estructura + backend mínimo) | ✅ Completada | 2026-04-13 |
| 2 | Splash screen (logo + animaciones + dron + agua) | ✅ Completada | 2026-04-13 |
| 3 | Pantalla de planificación (MapLibre + zona picker + base) | ✅ Completada | 2026-04-14 |
| 4 | SITL ArduPlane (conexión MAVLink + telemetría WebSocket) | ✅ Completada | 2026-04-14 |
| 5 | Simulador base (mapa 3D + HUD + Gamepad API + RC override) | ✅ Completada | 2026-04-14 |
| SITL fix | Race condition MAVProxy — arranque en 2 fases | ✅ Completado | 2026-05-04 |
| **F-0** | **ws_bridge.py** — WebSocket server :8765 + TCP :14555 + MAVLink parser | ✅ Completada | 2026-05-04 |
| **F-1** | **MongoDB + fleet API** — docker-compose + Motor + /api/fleet/* | ✅ Completada | 2026-05-04 |
| **F-2** | **Frontend ws_bridge** — split WS + binario 9B + MongoDB debrief | ✅ Completada | 2026-05-04 |
| 6 | Motor de fuego (autómata celular + capas GeoJSON) | ✅ Ya existía | — |
| 7 | Geofence en vuelo (R1/L1 + polígono + preview) | ✅ Ya existía | — |
| 8 | Enjambre (boustrophedon + animación drones cisterna) | ✅ Ya existía | — |
| 9 | Puntuación y debrief (modal + cálculo de score) | ✅ Ya existía | — |
| 10 | Polish (sonidos + efectos visuales + ajuste dificultad) | ✅ Completada | 2026-05-04 |

---

## 2. Fase 1 — Base del proyecto

**Fecha:** 2026-04-13  
**Objetivo:** Estructura de carpetas, arranque del sistema y endpoints mínimos funcionales.

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `start.bat` | Lanza backend (puerto 8000) + frontend (puerto 3000) + abre navegador |
| `shutdown.bat` | Cierra los procesos por título de ventana CMD |
| `backend/main.py` | FastAPI app con lifespan, CORS configurado, router health incluido |
| `backend/config.py` | Clase `Settings` cargada de `.env` mediante `python-dotenv` |
| `backend/.env` | Variables: `MAVLINK_HOST`, `MAVLINK_PORT`, `MAVLINK_BAUD`, `SITL_MODE`, `WSL_DISTRO`, `FRONTEND_URL` |
| `backend/requirements.txt` | `fastapi==0.115.0`, `uvicorn[standard]==0.30.6`, `pymavlink==2.4.41`, `websockets==13.1`, `python-dotenv==1.0.1` |
| `backend/api/routes/health.py` | `GET /health` → devuelve estado del sistema (mavlink_connected, sitl_running, timestamp) |
| `backend/api/__init__.py` | Package init vacío |
| `backend/api/routes/__init__.py` | Package init vacío |
| `backend/api/websockets/__init__.py` | Package init vacío (se llenará en Fase 4) |
| `backend/mavlink/__init__.py` | Package init vacío (se llenará en Fase 4) |
| `backend/game/__init__.py` | Package init vacío (se llenará en Fase 6) |
| `backend/simulation/__init__.py` | Package init vacío (se llenará en Fase 4) |
| `frontend/index.html` | Punto de entrada — redirige inmediatamente a `pages/splash/splash.html` |
| `frontend/config.js` | `window.APP_CONFIG` con `API_URL`, `WS_TELEMETRY`, `WS_CONTROL`, `TERRAIN_TILE_URL`, `PNOA_WMS_URL`, `OPENFREEMAP_STYLE` |

### Estructura de carpetas completa

```
galicia-wildfire/
├── DEVLOG.md
├── GALICIA_WILDFIRE_PROJECT.md
├── start.bat
├── shutdown.bat
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── .env
│   ├── requirements.txt
│   ├── api/
│   │   ├── routes/
│   │   │   └── health.py
│   │   └── websockets/
│   ├── mavlink/
│   ├── game/
│   └── simulation/
└── frontend/
    ├── index.html
    ├── config.js
    ├── assets/
    │   ├── fonts/
    │   └── sounds/
    ├── components/
    │   ├── hud/
    │   ├── gamepad/
    │   ├── fire/
    │   ├── geofence/
    │   └── swarm/
    ├── pages/
    │   ├── splash/
    │   ├── planning/       ← placeholder (Fase 3)
    │   └── simulator/      ← vacío (Fase 5)
    └── services/
```

### Dependencias instaladas

```
py -m pip install -r backend/requirements.txt
```

Resultado: todas instaladas correctamente en Python 3.12.2.

---

## 3. Fase 2 — Splash screen

**Fecha:** 2026-04-13  
**Objetivo:** Pantalla de carga completa con logo animado, barra de progreso, dron de paso y navegación a planning.

### Archivos creados

| Archivo | Descripción |
|---------|-------------|
| `frontend/pages/splash/splash.html` | Estructura HTML: logo SVG inline de pinos en llamas, barra de progreso, wrapper del dron |
| `frontend/pages/splash/splash.css` | Todos los estilos y `@keyframes`: ceniza, flicker llamas, dron, gotas, splash, vapor, destello, fadeout |
| `frontend/pages/splash/splash.js` | Lógica de carga en 5 pasos, animación dron, gotas con efectos de extinción |
| `frontend/pages/planning/index.html` | Placeholder mínimo para que la navegación del splash no produzca 404 |

### Secuencia de la animación (implementada)

```
DOMContentLoaded
  │
  ├─ spawnAshParticles()          28 partículas de ceniza CSS con deriva aleatoria
  │
  └─ [400ms] progressSection.visible
       │
       ├─ [+400ms] 20% — "Inicializando sistema MAVLink..."
       ├─ [+900ms] 45% — "Cargando cartografía de Galicia..."
       ├─ [+700ms] 70% — "Generando modelos de terreno..."
       ├─ [+800ms] 90% — "Calibrando simulador de vuelo..."
       └─ [+300ms] 100% — "Sistema listo"
            │
            └─ [+500ms] blinkReadyAndLaunch()   2 parpadeos del texto
                 │
                 └─ launchDrone()
                      │
                      ├─ getBoundingClientRect(.logo-svg)  posición exacta del logo
                      ├─ droneTopY = flameTipY - droneH   dron rasca las llamas
                      ├─ [CSS] animation: dronePass 1.5s ease-in-out
                      │
                      ├─ [+650ms] releaseWaterDrops()
                      │    ├─ 6 gotas en abanico (−55px a +55px respecto al centro del logo)
                      │    ├─ fallDist calculado dinámicamente hasta zona de fuego
                      │    ├─ [+600ms] createDouseFlash()   destello azul radial
                      │    └─ cada gota al aterrizar → createSplash() + createSteam()
                      │
                      ├─ [+650ms] douseFlames(900ms)   logo opacity 0.28 → recupera
                      │
                      └─ [+1500ms] startFadeOut()
                           └─ [+630ms] window.location → planning/index.html
```

### Componentes visuales del logo SVG (inline, sin imágenes)

- **3 pinos gallegos estilizados** con copa en capas triangulares (`#2a2a2a`, stroke `#e8e0d0`)
- **Llamas** con gradientes `gFlame1` (carmesí → naranja → amarillo), `gFlame2` (brillo interior), `gFlame3` (punta transparente)
- **4 clases de flicker** (`flicker-a/b/c/d`) con `animation-delay` escalonado para asincronía natural
- **Drone SVG** (200×56px): fuselaje torpedo, alas barridas con winglets, cola en T, hélice pusher, luces de navegación (blanco/verde/rojo)

### Restricciones respetadas (§4.5 del spec)

- ✅ Sin canvas, sin WebGL, sin librerías externas
- ✅ Sin fetch real al backend durante la carga
- ✅ Sin imágenes externas — todo SVG inline o CSS

---

## 4. Registro de bugs y soluciones

### BUG-001 — Python no encontrado al ejecutar start.bat

| Campo | Detalle |
|-------|---------|
| **Fecha** | 2026-04-13 |
| **Síntoma** | Al ejecutar `start.bat`, las ventanas CMD mostraban: *"no se encontró Python; ejecutar sin argumentos para instalar desde el Microsoft Store..."* tanto en la ventana del backend como del frontend |
| **Causa** | Windows 11 instala por defecto un alias `python` en `%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe` que no ejecuta Python real sino que abre la Microsoft Store. El comando `where python` devuelve este alias sin error, por lo que la comprobación `where python >nul 2>&1` daba falso positivo |
| **Archivos afectados** | `start.bat` |
| **Solución** | Usar `py` (Python Launcher para Windows) como primera opción. El Python Launcher se instala automáticamente con cualquier instalación estándar de Python en Windows y no está sujeto al alias de la Store. Se añadió detección en cascada: `py` → rutas absolutas Python 3.12 → Python 3.11 → error con mensaje claro |
| **Código fix** | `start.bat` — bloque de detección reescrito: |

```batch
py --version >nul 2>&1
if %errorlevel%==0 (
    set PYTHON=py
    goto :found
)
if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" (
    set PYTHON="%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    goto :found
)
...
```

| **Verificación** | `py --version` → `Python 3.12.2` ✅ |
| **Estado** | ✅ Resuelto |

---

## 5. Iteraciones y mejoras post-implementación

### MEJORA-001 — Dron y agua de la splash screen

**Fecha:** 2026-04-13  
**Solicitud:** *"el dron y el agua se puede mejorar — me gustaría que el dron pasase por encima de los árboles y las gotas pareciesen que apagan el fuego"*

#### Problema original

- El dron se posicionaba en `window.innerHeight / 2 - 50`, completamente desconectado de la posición real del logo en pantalla
- Las gotas caían una distancia fija de 130px sin relación con la posición del fuego
- No había retroalimentación visual de extinción

#### Solución implementada

**Posicionamiento preciso del dron:**

```javascript
// Antes (posición ciega):
const vCenter = (window.innerHeight / 2) - 50;

// Después (posición calculada desde el DOM):
const logoRect  = document.querySelector('.logo-svg').getBoundingClientRect();
const flameTipY  = logoRect.top + logoRect.height * 0.07;   // punta llama en pantalla
const droneTopY  = flameTipY - DRONE_H + 6;                 // solapa 6px con las llamas
```

**Caída dinámica de gotas al foco de fuego:**

```javascript
// Antes (distancia fija):
{ transform: translateY(130px) }

// Después (distancia calculada):
const fireZoneY = logoRect.top + logoRect.height * 0.40;
const fallDist  = fireZoneY - droneBottomY;
// CSS usa: var(--drop-fall) asignado por JS
```

**Efectos de extinción añadidos:**

| Efecto | Implementación | Duración |
|--------|---------------|----------|
| Splash de impacto | `.water-splash` → `@keyframes splashExpand` (scale 1→5.5) | 550ms |
| Vapor/steam | `.steam-puff` × 3 por gota → `@keyframes steamRise` (sube 38px) | 750ms |
| Destello azul | `.douse-flash` → gradiente radial + `@keyframes flashFade` | 450ms |
| Llamas apagadas | `.logo-svg.water-hit { opacity: 0.28 }` con `transition: 0.35s` | 900ms |

**Rediseño SVG del dron** (de 160×52 a 200×56px):

| Elemento | Antes | Después |
|----------|-------|---------|
| Fuselaje | Elipse simple | Path torpedo con estrechamiento en cola |
| Alas | Polígonos simples | Polígonos + winglets en punta |
| Cola | Triángulos mínimos | Estabilizadores H + aleta V diferenciados |
| Hélice | Elipse decorativa | Hub + 2 palas con forma de pala real |
| Luces nav | Sin luces | Blanco (nariz) + verde (ala N) + rojo (ala S) |

---

## 6. Decisiones de arquitectura aplicadas

> Referencia: §18 del spec — NO CAMBIAR

| Decisión | Estado | Notas de implementación |
|----------|--------|------------------------|
| Frontend Vanilla JS sin SPA | ✅ Respetado | `splash.js` es JS puro, sin imports ni bundler |
| Sin canvas en splash | ✅ Respetado | Todo animado con CSS `@keyframes` y SVG inline |
| Sin librerías externas en splash | ✅ Respetado | Solo Google Fonts CDN (tipografía, no funcional) |
| Backend FastAPI async | ✅ Respetado | `lifespan` async, rutas async |
| Config por hostname | ✅ Respetado | `window.APP_CONFIG` usa `window.location.hostname` |
| SITL ArduPlane (no ArduCopter) | 🔲 Pendiente | Se implementa en Fase 4 |

---

## 7. Pendiente

### Próxima sesión — Fase 4: SITL ArduPlane

Implementar según §15 del spec:

- [ ] `backend/mavlink/connection.py` — MAVLink connection manager con asyncio.Lock en _read_loop
- [ ] `backend/mavlink/telemetry.py` — parsing ATTITUDE, GPS, HEARTBEAT, VFR_HUD
- [ ] `backend/mavlink/commands.py` — arm/disarm, set_mode, takeoff, rc_override
- [ ] `backend/api/websockets/telemetry_ws.py` — WS /ws/telemetry broadcaster privado por cliente
- [ ] `backend/api/websockets/control_ws.py` — WS /ws/control
- [ ] `backend/simulation/sitl_manager.py` — arranque ArduPlane en WSL2
- [ ] Actualizar `/health` con mavlink_connected y sitl_running reales
- [ ] Actualizar `lifespan` en main.py para conectar MAVLink al arrancar

### Avisos para sesiones futuras

> **Python en Windows:** Usar siempre `py` en lugar de `python` en scripts `.bat` y documentación. Ver BUG-001.

> **ArduPlane vs ArduCopter (Fase 4):** El throttle neutro en ArduPlane es 1000 (ralentí), no 1500 como en ArduCopter. RC ch3 no es spring-back. Ver §15.3 del spec.

> **Thread-safety MAVLink (Fase 4):** Usar `asyncio.Lock` en `_read_loop` del connection manager. Patrón ya resuelto en el proyecto Drone Simulator anterior.

> **WebSocket broadcaster (Fase 4):** Usar broadcaster privado por cliente (no broadcast global). También resuelto en proyecto anterior.

---

---

## 8. Fase 3 — Pantalla de planificación

**Fecha:** 2026-04-14  
**Objetivo:** Layout dos columnas con panel de misión y mapa MapLibre 3D interactivo.

### Archivos creados / modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `backend/game/wind.py` | Nuevo | `generate_wind()` → direction_deg (0-360), speed_kmh (8-55) |
| `backend/game/fire_engine.py` | Nuevo | `generate_fires()` con Haversine, bboxes de las 4 zonas, distancias mínimas |
| `backend/api/routes/game.py` | Nuevo | `GET /api/game/zones` + `POST /api/game/new-game` con Pydantic |
| `backend/main.py` | Modificado | Añadido `game_router` |
| `frontend/pages/planning/index.html` | Reescrito | Layout dos columnas, panel lateral completo, rosa de vientos SVG inline |
| `frontend/pages/planning/planning.css` | Nuevo | Estilos completos: cards, coords, meteorología, botones, toast |
| `frontend/pages/planning/planning.js` | Nuevo | MapLibre, zona picker, marcador base, generación de misión |
| `frontend/pages/simulator/index.html` | Nuevo | Placeholder Fase 5 — muestra game_state de sessionStorage |

### Flujo implementado

```
Carga página → initMap() + renderZoneCards() + checkBackendStatus()
  │
  ├─ Badge backend: GET /health cada 30s → verde/rojo
  │
  ├─ Click zona card → selectZone(id)
  │     └─ map.flyTo({ pitch:45, bearing:-15, duration:1800 })
  │     └─ setPlacingBase(true) → cursor crosshair en mapa
  │
  ├─ Click mapa (placingBase=true) → placeBase(lngLat)
  │     └─ Marcador SVG rojo "H" arrastrable
  │     └─ Mostrar lat/lon en panel
  │     └─ updateButtonState() → habilita GENERAR MISIÓN
  │
  ├─ GENERAR MISIÓN → POST /api/game/new-game
  │     └─ Mostrar sección meteorología (rosa de vientos + alerta)
  │     └─ Mostrar focos con marcadores SVG llama en el mapa
  │     └─ Cambiar a botón INICIAR MISIÓN
  │
  └─ INICIAR MISIÓN
        └─ sessionStorage.setItem('gw.gameState', JSON.stringify(gameState))
        └─ navigate → ../simulator/index.html
```

### Decisiones técnicas

| Decisión | Razón |
|----------|-------|
| Terreno: Terrarium (AWS) como fallback | MapTiler requiere key — sin key el mapa sigue funcionando en 3D con tiles gratuitos |
| Misión en dos pasos (GENERAR + INICIAR) | El usuario puede ver las condiciones antes de comprometerse |
| `sessionStorage` para pasar game_state al simulador | Sin estado de servidor, sin URL params complejos |
| Focos mostrados ya en planificación | El usuario puede ver dónde están los incendios antes de despegar |
| `AbortSignal.timeout(3000)` en health check | Evita que un backend lento bloquee la UI |

---

## 9. Fase 4 — SITL ArduPlane + MAVLink + WebSocket

**Fecha:** 2026-04-14  
**Objetivo:** Conectar el backend con ArduPlane SITL via MAVLink, emitir telemetría por WebSocket y aceptar comandos de control.

### Archivos creados / modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `backend/mavlink/telemetry.py` | Nuevo | `TelemetryData` dataclass, `ARDUPILOT_PLANE_MODES`, `parse_mavlink_message()` |
| `backend/mavlink/connection.py` | Nuevo | `MAVLinkManager`: conexión UDP, `_read_loop`, mock automático si SITL no disponible |
| `backend/mavlink/commands.py` | Nuevo | `CommandSender`: arm/disarm, set_mode, takeoff, rc_override, rtl, set_home |
| `backend/mavlink/mission.py` | Nuevo | `MissionManager`: upload/download MAVLink, `fires_to_mission()` |
| `backend/api/websockets/telemetry_ws.py` | Nuevo | `ConnectionManager` con colas privadas por cliente, `_telemetry_broadcaster()` |
| `backend/api/websockets/control_ws.py` | Nuevo | Endpoint WS `/ws/control`: procesa acciones arm/disarm/set_mode/rc_override/etc. |
| `backend/simulation/sitl_manager.py` | Nuevo | `SITLManager`: modo external (usuario) o managed (WSL2 interop) |
| `backend/api/routes/simulation.py` | Nuevo | `POST /api/simulation/restart-at` + `POST /api/simulation/upload-mission` |
| `backend/api/routes/health.py` | Modificado | Devuelve `mavlink_connected`, `mavlink_mock` y `sitl_running` reales |
| `backend/main.py` | Reescrito | Lifespan completo: `MAVLinkManager.connect()` + broadcaster WS + gestión shutdown |

### Decisiones técnicas

| Decisión | Razón |
|----------|-------|
| `asyncio.Lock` en `_send_lock` | Serializar envíos MAVLink desde múltiples corrutinas (arm, rc_override, etc.) |
| `recv_paused` flag | Ceder el socket al upload de misión sin cerrar el read_loop |
| Cola privada `asyncio.Queue(maxsize=1)` por cliente | Descarta frames si el cliente va lento; no bloquea el broadcaster |
| Mock automático si SITL no conecta | Permite desarrollo del frontend sin SITL activo (telemetría circular simulada) |
| ArduPlane modos: FBWA=5, RTL=11, CRUISE=7 | Spec §15 — diferente a ArduCopter |
| `ARSPD_USE=0` en parámetros SITL | Sin sensor de velocidad aérea real en simulación |
| OpenTopoData para altitud home | Gratis, sin API key, SRTM30M cubre Galicia |
| `fires_to_mission()` independiente | Se puede invocar sin SITL activo para previsualizar waypoints |

### Rutas backend añadidas

| Ruta | Método | Descripción |
|------|--------|-------------|
| `/ws/telemetry` | WebSocket | Telemetría a 5 Hz (real o mock) |
| `/ws/control` | WebSocket | Comandos: arm, set_mode, rc_override, rtl, start_mission... |
| `/api/simulation/restart-at` | POST | Reinicia SITL en coordenadas de la base |
| `/api/simulation/upload-mission` | POST | Sube waypoints de focos al autopiloto |

### Protocolo WebSocket telemetría (spec §11.1)

```json
{
  "type": "telemetry",
  "data": {
    "ts": 1713097800.123,
    "lat": 42.6000000, "lon": -7.0500000,
    "alt_msl": 850.0, "alt_rel": 80.0,
    "roll": 8.2, "pitch": 1.5, "yaw": 270.0,
    "airspeed": 22.0, "groundspeed": 21.5,
    "vertical_speed": 0.1, "throttle_pct": 65,
    "mode": "CRUISE", "mode_num": 7, "armed": true,
    "hdop": 0.9, "satellites": 12,
    "battery_v": 0.0, "battery_pct": -1,
    "wp_num": 2, "wp_dist": 340.5,
    "nav_bearing": 185.0, "mission_total": 5
  }
}
```

---

---

## 10. Fase 5 — Simulador base

**Fecha:** 2026-04-14  
**Objetivo:** Pantalla del simulador con mapa 3D, marcador del dron, HUD completo, Gamepad API y RC override por WebSocket.

### Archivos creados / modificados

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `frontend/pages/simulator/index.html` | Reescrito | Layout full-screen: mapa + 6 paneles HUD flotantes + banners + botones |
| `frontend/pages/simulator/simulator.css` | Nuevo | Estilos del simulador: marcador dron, controles de mapa, badge mock |
| `frontend/pages/simulator/simulator.js` | Nuevo | Motor principal: MapLibre, telemetría WS, marcador dron, integración HUD/Gamepad |
| `frontend/components/hud/hud.css` | Nuevo | Estilos HUD: paneles, horizonte artificial, badges de modo/arm, botones |
| `frontend/components/hud/hud.js` | Nuevo | Clase `HUD`: update(data), _updateAttitude(), _updateMode(), setWind() |
| `frontend/components/gamepad/gamepad.js` | Nuevo | Clase `GamepadController`: polling 50Hz, deadzone, suavizado, teclado fallback |
| `frontend/services/control.js` | Nuevo | Clase `ControlWebSocket`: envío de comandos + RC override, reconexión automática |
| `frontend/pages/planning/planning.js` | Modificado | `startMission()` async: llama restart-at + upload-mission antes de navegar |

### Paneles HUD implementados

| Panel | Posición | Contenido |
|-------|----------|-----------|
| Superior izquierdo | `top:16 left:16` | IAS, GS, ALT AGL, HDG, V/S — fuente monoespaciada verde HUD |
| Superior derecho | `top:16 right:16` | Horizonte artificial CSS (roll rotación, pitch desplazamiento vertical) |
| Superior centro | `top:16 center` | Viento — dirección y velocidad (fijo desde gameState) |
| Inferior central | `bottom:20 center` | Badge modo + badge arm + botones FBWA/CRUISE/RTL + botón ARM |
| Inferior izquierdo | `bottom:70 left:16` | WP actual / total + distancia al siguiente WP |

### Mapeo Gamepad Xbox (spec §8.2)

| Input | Índice API | RC channel |
|-------|-----------|------------|
| Stick izq X | `axes[0]` | ch1 — aileron |
| Stick izq Y | `axes[1]` | ch2 — elevator |
| Stick dcho X | `axes[2]` | ch4 — rudder |
| R2 (trigger) | `axes[5]` | ch3 throttle ↑ |
| L2 (trigger) | `axes[4]` | ch3 throttle ↓ |
| A | `buttons[0]` | ARM / DISARM toggle |
| B | `buttons[1]` | Modo FBWA |
| X | `buttons[2]` | Modo CRUISE |
| Y | `buttons[3]` | RTL |

### Decisiones técnicas

| Decisión | Razón |
|----------|-------|
| PNOA activo por defecto en simulador | Spec §6.2 — ortofoto da mejor referencia de terreno en vuelo |
| Exageración terreno 1.8 (vs 1.5 en planning) | Más dramático durante el vuelo (spec §6.2) |
| `followDrone=true` por defecto | Mapa sigue al dron; se desactiva si el usuario arrastra el mapa; botón para reactivar |
| Drone LED parpadea cuando armado | CSS `@keyframes ledBlink` sobre el elemento SVG `#droneLED` |
| RC override solo en modos manuales | Lógica en el backend (`commands.py`), no en el frontend |
| Banner "mock" visible si `health.mavlink_mock=true` | El usuario sabe que está en modo simulado sin SITL |
| `startMission()` async en planning | Llama restart-at (HOME SITL) + upload-mission antes de navegar — feedback del usuario |

### SITL startup timing (feedback usuario)

El SITL se arranca **después** de que el usuario confirma la misión en planning, pasando las coordenadas de la base como HOME. Una vez que SITL está corriendo no se puede cambiar el HOME fácilmente.

Secuencia en `startMission()`:
1. `POST /api/simulation/restart-at` → SITL arranca con `--home lat,lon,alt,0`
2. `POST /api/simulation/upload-mission` → waypoints de focos subidos al autopiloto
3. `sessionStorage + navigate` → simulator

---

*Última actualización: 2026-05-04*

---

## 12. Arquitectura Revisada — ws_bridge + MongoDB (2026-05-04)

**Sesión:** 2026-05-04  
**Motivo:** Nuevas constraints del ejercicio F + decisión Option B para reducir latencia gamepad.

### 12.1 Decisiones de arquitectura nuevas

| Decisión | Elegida | Alternativa descartada | Razón |
|----------|---------|----------------------|-------|
| DB | MongoDB (Docker) | PostgreSQL (Docker) | Telemetría post-misión requiere esquema flexible + volumen variable |
| WS real-time | ws_bridge.py independiente | FastAPI WebSocket | Elimina overhead async FastAPI del path crítico (-20-25ms) |
| Control RC | ws_bridge TCP:14555 → MAVProxy | FastAPI → pymavlink UDP | Misma conexión bidireccional, menos saltos |
| Docker scope | Solo MongoDB | Backend + DB | Backend necesita invocar WSL2 para SITL, imposible desde Docker |

### 12.2 Análisis de fuentes de delay (línea base)

Ver tabla completa en §21.3 del PROJECT.md. Resumen:

| Delay | Antes | Después | Mejora |
|-------|-------|---------|--------|
| FastAPI async overhead | 2–8ms | 0ms (ws_bridge) | -8ms |
| JSON serialize/parse | 0.5–2ms | 0ms (binario 9B) | -2ms |
| Payload size | 80–120B | 9B | -93% |
| Poll rate gamepad | 20ms | 20ms | — (límite HW) |
| MAVProxy forward | 5–15ms | 5–15ms | — |
| **Total estimado** | **30–50ms** | **22–27ms** | **~-20ms** |

### 12.3 Puntos de fallo potenciales registrados

| ID | Componente | Riesgo | Mitigación |
|----|-----------|--------|-----------|
| F-01 | ws_bridge TCP | MAVProxy no conecta si IP Windows cambia | Leer IP dinámica desde WSL `/etc/resolv.conf` |
| F-02 | ws_bridge arranque | SITL lanza antes de que ws_bridge esté listo | ws_bridge arranca en start.bat antes del backend |
| F-03 | MongoDB Docker | Container no iniciado al arrancar backend | start.bat espera con `docker compose up -d` antes de FastAPI |
| F-04 | pymavlink UDP | FastAPI pymavlink y ws_bridge compiten por datos | Ambos reciben; MAVLink permite múltiples GCS |
| F-05 | ws_bridge TCP | Solo acepta una conexión de MAVProxy | Verificar que tcpin acepta reconexión si MAVProxy reinicia |

### 12.4 Archivos nuevos creados en esta sesión

| Archivo | Descripción |
|---------|-------------|
| `docker-compose.yml` | MongoDB 7 en Docker, puerto 27017 |
| `backend/ws_bridge/__init__.py` | Package init |
| `backend/ws_bridge/ws_bridge.py` | Puente WS:8765 ↔ TCP:14555 ↔ MAVLink |
| `backend/db/mongo_init.py` | Inserta flota inicial en MongoDB si vacía |
| `backend/api/routes/fleet.py` | REST /api/fleet/* con Motor (async) |

### 12.5 Archivos creados en esta sesión

| Archivo | Descripción |
|---------|-------------|
| `docker-compose.yml` | MongoDB 7 en Docker, puerto 27017, volumen persistente |
| `backend/ws_bridge/__init__.py` | Package init |
| `backend/ws_bridge/ws_bridge.py` | WS server :8765 + TCP server :14555 + MAVLink parser + RC binary decode |
| `backend/db/__init__.py` | Package init |
| `backend/db/mongo_init.py` | Inserta 9 drones iniciales si colección vacía |
| `backend/api/routes/fleet.py` | REST /api/fleet/* con Motor (6 endpoints) |

### 12.6 Archivos modificados en esta sesión

| Archivo | Cambio |
|---------|--------|
| `backend/simulation/sitl_manager.py` | `_build_mavproxy_command`: añade `--out tcpout:IP:14555` |
| `backend/requirements.txt` | Añade `motor==3.4.0`, `pymongo==4.7.0` |
| `backend/.env` | Añade `MONGODB_URI`, `WS_BRIDGE_TCP_PORT`, `WS_BRIDGE_WS_PORT` |
| `backend/config.py` | Añade `MONGODB_URI`, `WS_BRIDGE_TCP_PORT`, `WS_BRIDGE_WS_PORT` |
| `backend/main.py` | Motor client init en lifespan + `seed_fleet()` + `fleet_router` |
| `frontend/config.js` | `WS_TELEMETRY` → ws_bridge:8765; `WS_CONTROL` permanece en FastAPI:8000 |
| `frontend/pages/simulator/simulator.js` | `_bridgeWs` + `_encodeRC()` + RC override binario en `onRC` callback |
| `start.bat` | Lanza MongoDB (Docker) + ws_bridge + backend + frontend (4 pasos) |

### 12.7 Fases completadas en esta sesión

| Fase | Estado | Fecha |
|------|--------|-------|
| F-0 ws_bridge | ✅ Implementada | 2026-05-04 |
| F-1 MongoDB + fleet | ✅ Implementada | 2026-05-04 |
| F-2 Frontend ws_bridge | ✅ Implementada | 2026-05-04 |

### 12.8 Pendiente para próxima sesión

1. **Instalar dependencias nuevas:** `py -m pip install motor pymongo` (en directorio backend)
2. **Verificar SITL end-to-end:** `start.bat` → misión → logs `[WS-Bridge] MAVProxy conectado` + `[DB] Flota inicializada`
3. **Verificar gamepad binario:** En DevTools → Network → WS → ver frames binarios (9B) en lugar de JSON
4. **Continuar Fase 6:** Motor de fuego (autómata celular + capas GeoJSON)

---

## 11. Nuevas Constraints — Ejercicio F (2026-05-04)

**Origen:** Documento de texto con requisitos adicionales del ejercicio académico.

### 11.1 Resumen de cambios requeridos

| Área | Constraint | Sección spec |
|------|-----------|--------------|
| Docker + BBDD | Base de datos PostgreSQL en Docker con flota de drones | §22 |
| Arquitectura | Diagrama explícito HMI→Backend→MAVProxy→SITL | §21 |
| Gamepad | Reducir lag: compresión binaria o método óptimo | §23 |

### 11.2 Docker + MongoDB (revisado — antes era PostgreSQL)

**Decisión cambiada:** MongoDB en lugar de PostgreSQL para soportar telemetría post-misión (esquema flexible, volumen de datos variable).

**Qué hay que hacer:**
- Crear `docker-compose.yml` en la raíz (servicio `mongodb`)
- Crear `backend/db/mongo_init.py` con inserciones iniciales de flota
- Añadir `motor==3.4.0` + `pymongo==4.7.0` a `requirements.txt`
- Crear `backend/api/routes/fleet.py` con endpoints `/api/fleet/*`
- Integrar en planning (badge drones disponibles) y debrief (guardar misión + telemetría)

### 11.3 ws_bridge.py — nuevo componente (revisado respecto al plan anterior)

**Decisión:** En lugar de mejorar el WebSocket de FastAPI, se crea un proceso independiente `ws_bridge.py` que actúa como puente directo entre MAVProxy y el HMI.

**Por qué:** Elimina FastAPI del path real-time → reduce ~20–25ms de latencia por frame de control.

**MAVProxy comando actualizado:**
```bash
mavproxy.py --master tcp:127.0.0.1:5760 \
            --out udp:WINDOWS_IP:14550 \      # FastAPI (comandos ARM/modos)
            --out tcpout:WINDOWS_IP:14555 \   # ws_bridge (telemetría + RC override)
            --non-interactive
```

### 11.4 Optimización gamepad

**Decisión tomada:** Solución A (binario 9B) implementada en ws_bridge (no en control_ws.py de FastAPI).

**Reducción esperada:** ~93% menos bytes (80-120B JSON → 9B binario).

**Archivos a modificar:**
- `frontend/components/gamepad/gamepad.js` — `encodeRC()` + enviar a ws_bridge:8765
- `backend/ws_bridge/ws_bridge.py` — decoder binario + envío MAVLink RC_CHANNELS_OVERRIDE

### 11.5 Orden de implementación actualizado

1. **F-0:** `ws_bridge.py` — proceso independiente WS:8765 + TCP:14555
2. **Actualizar `sitl_manager.py`** — añadir `tcpout` al comando MAVProxy
3. **F-1:** `docker-compose.yml` (MongoDB) + `mongo_init.py` + `fleet.py`
4. **F-2:** Frontend apunta a ws_bridge + binario 9B en gamepad.js
5. **Actualizar `start.bat`** — lanzar Docker + ws_bridge + backend + frontend
6. Continuar con Fase 6 (motor de fuego)

---

## 13. Sesión 2026-05-04 (continuación) — WS split + MongoDB debrief + Fleet badge

**Fecha:** 2026-05-04

### 13.1 Bug resuelto — fire_update y swarm_update no llegaban al browser

**Síntoma:** Tras apuntar `WS_TELEMETRY` a ws_bridge:8765, el motor de fuego y el enjambre dejaron de actualizarse en pantalla.

**Causa:** ws_bridge solo tiene acceso a MAVLink sobre TCP. Los eventos `fire_update` y `swarm_update` son generados internamente por los engines de FastAPI y se emiten en `/ws/telemetry` de FastAPI, canal al que ws_bridge no tiene acceso.

**Solución:** Split de la conexión WS en simulator.js en dos funciones independientes:

| Función | Endpoint | Datos |
|---------|----------|-------|
| `initTelemetryWS()` | ws_bridge:8765 | MAVLink telemetría + RC override binario |
| `initEventsWS()` | FastAPI:8000/ws/telemetry | `fire_update` + `swarm_update` game events |

Se añadió `WS_EVENTS` en `frontend/config.js` para separar las dos URLs.

**Punto de fallo F-06 identificado:**
> Si ws_bridge no está arriba cuando el simulador carga, el browser reintentará `initTelemetryWS` cada 3s (reconexión automática). Los eventos de juego siguen funcionando desde FastAPI mientras tanto.

### 13.2 MongoDB integrado en flujo de partida

| Momento | Acción | Endpoint |
|---------|--------|----------|
| `startFires()` (inicio de misión) | Crea registro de misión | `POST /api/fleet/missions` |
| `showDebrief()` (fin de misión) | Guarda score + estadísticas | `PUT /api/fleet/missions/{id}/end` |

Se almacena `_dbMissionId` en el módulo para enlazar inicio y fin de misión. Si el backend no responde, el debrief sigue mostrándose (el guardado en BD es best-effort).

### 13.3 Badge de drones disponibles en planning

**Archivo modificado:** `frontend/pages/planning/planning.js`

Se añadió `fetchFleetCount()` llamada desde `checkBackendStatus()` cuando el backend está online. Muestra `· N drones` junto al badge de estado en el header del panel.

**Archivos modificados:**

| Archivo | Cambio |
|---------|--------|
| `frontend/pages/planning/index.html` | `<span id="fleetCount">` en el backend-badge |
| `frontend/pages/planning/planning.js` | `fetchFleetCount()` → `GET /api/fleet/drones/available` |
| `frontend/pages/planning/planning.css` | `.badge-fleet` — estilo monoespaciado gris |
| `frontend/config.js` | `WS_EVENTS` → FastAPI:8000/ws/telemetry |
| `frontend/pages/simulator/simulator.js` | `initTelemetryWS()` + `initEventsWS()` split; `startFires()` + `showDebrief()` MongoDB |

### 13.4 Descubrimiento: fases 6–9 ya estaban implementadas

Al revisar el código existente se confirmó que las fases 6 (motor de fuego), 7 (geofence), 8 (enjambre) y 9 (debrief modal + score) ya estaban completamente implementadas en sesiones anteriores no registradas en este DEVLOG. La tabla de fases (§1) ha sido actualizada para reflejarlo.

### 13.5 Pendiente — Fase 10

~~Completada en §14 (misma sesión)~~

---

## 14. Fase 10 — Polish (2026-05-04)

**Fecha:** 2026-05-04  
**Objetivo:** Sonidos, efectos visuales y ajuste de dificultad.

### 14.1 Motor de audio sintetizado

**Archivo nuevo:** `frontend/assets/sounds/audio.js`  
**Técnica:** Web Audio API — cero archivos externos, todo sintetizado con osciladores y ruido filtrado.

| Método | Sonido | Trigger |
|--------|--------|---------|
| `arm()` | 2 pitidos ascendentes (square wave) | Telemetría cambia a `armed=true` |
| `disarm()` | 2 pitidos descendentes | Telemetría cambia a `armed=false` |
| `geofenceClose()` | Acorde C-E-G (sine) | Botón LB / geofence_close |
| `swarmLaunch()` | Whoosh + zumbido de motores cisterna | POST /api/game/launch-swarm OK |
| `alert()` | 3 pitidos de alerta (880 Hz) | Reservado para viento fuerte (extensión futura) |
| `debriefFanfare(score)` | Fanfarria / acorde / menor según score | `showDebrief()` |
| `startFireCrackle()` | Ruido bandpass 700 Hz (looping) | Primera `fire_update` con celdas BURNING |
| `stopFireCrackle()` | Fade out 1.5s | Todas las celdas BURNED o debrief |

**Política de autoplay:** `unlock()` se llama en el primer `click`, `keydown`, o `gamepadconnected`. Sin user gesture el contexto de audio queda suspendido y los sonidos simplemente no suenan.

### 14.2 Efectos visuales

**Marcadores de incendio — CSS flicker:**
- `@keyframes fireFlicker` en `simulator.css`: scale + opacity varía en 5 keyframes
- Duraciones distintas para cada `nth-child` (1.3s / 1.6s / 1.9s) para evitar sincronización visual

**Partículas de humo:**
- `spawnSmoke(cells)` en `simulator.js`: throttle a 1.8s entre spawns
- Proyecta una celda BURNING a pantalla con `mapgl.project([lon, lat])`
- Crea `<div class="smoke-particle">` con desplazamiento aleatorio (±22px X, ±12px Y)
- CSS: `@keyframes smokeRise` — sube 105px escalando de ×1 a ×4, fade out en 3.2s
- Se auto-elimina con `animationend`

**ARM flash:**
- `@keyframes armPulse` — ring de color verde que se expande y desaparece (0.5s)
- Clase `.arm-flash` añadida/eliminada via JS en `onArmedChange`
- `void badge.offsetWidth` para forzar reflow y permitir re-trigger de la animación

**Debrief — categoría de resultado:**
- `<div id="debriefCategory">` entre zona y tabla
- Clases: `cat-excellent` (verde, ≥75), `cat-good` (naranja, 45-74), `cat-poor` (rojo, <45)
- Texto: EXCELENTE / BUENO / MEJORABLE

### 14.3 Dificultad adaptativa del motor de fuego

**Backend: `backend/game/fire_spread.py`**

| Dificultad | Multiplicador prob. | Intervalo entre pasos |
|------------|--------------------|-----------------------|
| Muy alta   | ×1.70              | 6 s |
| Alta       | ×1.30              | 8 s |
| Media      | ×1.00              | 10 s (base) |
| Baja       | ×0.75              | 12 s |

**Flujo:**
1. `new-game` devuelve `difficulty` en el game_state (ya lo hacía)
2. `startFires()` en simulator.js pasa `difficulty: gameState.difficulty` al backend
3. `StartFiresRequest` acepta `difficulty: str = "Media"` (retrocompatible)
4. `FireSpreadEngine.__init__` lee `DIFFICULTY_PARAMS[difficulty.lower()]` → p_factor + spread_step

### 14.4 Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `frontend/assets/sounds/audio.js` | NUEVO — motor de audio sintetizado |
| `frontend/pages/simulator/simulator.css` | fireFlicker, smokeRise, armPulse, cat-* debrief |
| `frontend/pages/simulator/index.html` | script audio.js + `#debriefCategory` div |
| `frontend/pages/simulator/simulator.js` | audio wiring + smoke spawning + difficulty passthrough |
| `backend/game/fire_spread.py` | DIFFICULTY_PARAMS + FireSpreadEngine(difficulty) |
| `backend/api/routes/game.py` | StartFiresRequest.difficulty + fire_mgr.start(difficulty) |

### 14.5 Fuentes de delay — sin impacto en Phase 10

Ninguno de los cambios de Phase 10 toca el path crítico de telemetría/RC. Los sonidos y efectos visuales son puramente client-side y no añaden latencia al loop de control.
