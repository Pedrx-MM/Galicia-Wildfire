# Galicia Wildfire — Design Brief
> Documento preparado para sesión de diseño con Claude.  
> Pega este archivo + capturas de pantalla en claude.ai para obtener propuestas de mejora.

---

## 1. Contexto de la aplicación

**Qué es:** Simulador de extinción de incendios forestales con drones UAV (ArduPlane).  
**Tecnología UI:** HTML/CSS/JS puro + MapLibre GL JS para el mapa 3D. Sin frameworks (no React, no Vue).  
**Plataforma objetivo:** Pantalla completa de escritorio (1920×1080 mínimo). No es responsive.  
**Tono visual buscado:** Militar / operacional / HUD de aviación. Oscuro, denso en datos, sin decoración innecesaria.

---

## 2. Sistema de diseño actual

### 2.1 Paleta de colores

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-bg` | `#0a0a0a` | Fondo principal |
| `--color-surface` | `#141414` | Paneles laterales |
| `--color-surface-2` | `#1e1e1e` | Elementos sobre surface |
| `--color-surface-3` | `#252525` | Scrollbars, detalles |
| `--color-accent-fire` | `#e85d24` | Acción principal / fuego |
| `--color-accent-fire2` | `#f2a623` | Fuego secundario / ámbar |
| `--color-accent-water` | `#3bb8e0` | Agua / modo activo |
| `--color-text-primary` | `#f0ece4` | Texto principal |
| `--color-text-muted` | `#888880` | Texto secundario |
| `--color-success` | `#2da862` | OK / armado |
| `--color-danger` | `#c0392b` | Error / peligro |
| `--color-warning` | `#e8a020` | Advertencia |
| `--color-hud-green` | `#00ff88` | Telemetría HUD principal |
| `--color-hud-amber` | `#f2a623` | Modos AUTO/RTL |
| `--color-hud-red` | `#ff4444` | Modos MANUAL/ACRO / desarmado |
| `--color-hud-blue` | `#3bb8e0` | Modo LOITER / enjambre |
| `--color-hud-cyan` | `#00bfff` | FPV / modo TAKEOFF |

### 2.2 Tipografía

| Familia | Uso |
|---------|-----|
| `Inter` (400/500/600/700) | UI general, paneles, botones |
| `JetBrains Mono` (400/700) | Telemetría, valores numéricos, HUD, badges |

### 2.3 Constantes de forma

```
border-radius base:  6px (paneles), 4px (badges/botones), 20px (pills)
border estándar:     1px solid rgba(255,255,255,0.07–0.18)
backdrop-filter:     blur(8px) en paneles HUD, blur(12px) en modales
sombras modales:     0 24px 64px rgba(0,0,0,0.6)
spacing unidad:      8px
```

---

## 3. Pantallas

### 3.1 Splash Screen (`/pages/splash/`)

**Layout:** Centrado verticalmente, fondo negro `#0a0a0a`.  
**Elementos:**
- Logo SVG con llamas animadas (flicker asimétrico 4 capas, 0.8s)
- Título "GALICIA WILDFIRE" (Inter 700, 42px, letter-spacing 0.15em)
- Subtítulo en naranja apagado `#c8640a`
- Barra de progreso horizontal (3px, sin border-radius, gradiente fire→amber)
- Texto de estado en mono 12px
- Animación: dron SVG vuela de izquierda a derecha, suelta gotas de agua sobre el logo, el logo se apaga (opacity 0.28)
- Partículas de ceniza subiendo (JS)

**Problemas de diseño actuales:**
- El título es genérico; podría tener más carácter visual
- La transición al menú principal es brusca
- Las partículas de ceniza son demasiado sutiles

---

### 3.2 Pantalla de Planificación (`/pages/planning/`)

**Layout:** 2 columnas — panel izquierdo fijo (380px) + mapa MapLibre a la derecha.

**Panel izquierdo (de arriba a abajo):**
1. **Header** — Logo pequeño + título + badge de estado del backend (online/offline con punto verde/rojo)
2. **Sección ZONA** — 4 cards seleccionables (Serra do Courel / Fragas do Eume / Serra do Suido / Monte Pindo). Card seleccionada: borde naranja + fondo naranja 10%
3. **Sección BASE DE OPERACIONES** — hint de clic en mapa o coordenadas lat/lon en mono naranja
4. **Sección METEOROLOGÍA** — rosa de vientos SVG + velocidad (28px mono) + dirección + alerta (calm/mod/strong)
5. **Sección FOCOS DE INCENDIO** — caja con fondo naranja 7%, número de focos generados
6. **Footer de acciones** — botón primario naranja "GENERAR" + botón verde "INICIAR MISIÓN"

**Mapa:** MapLibre GL, fondo oscuro, marcador de base arrastrable (SVG cross naranja).

**Problemas de diseño actuales:**
- El panel izquierdo está muy condensado, difícil de leer de un vistazo
- Las zone cards son demasiado similares visualmente entre sí
- La rosa de vientos SVG es pequeña
- No hay ninguna animación de feedback cuando se genera la misión

---

### 3.3 Pantalla del Simulador (`/pages/simulator/`)

**Layout:** Mapa MapLibre full-screen + HUD panels superpuestos (position: absolute).

#### HUD Panels

| Panel | Posición | Contenido |
|-------|----------|-----------|
| `hud-topleft` | top:16 left:16 | IAS / GS / ALT / HDG / V/S en mono verde |
| `hud-topright` | top:16 right:16 | Horizonte artificial CSS (90px ring) + R/P |
| `hud-topcenter` | top:16 center | Viento: dirección + velocidad |
| `hud-bottom` | bottom:20 center | Mode badge + ARM badge + botones FBWA/CRUISE/RTL/ARM |
| `hud-wpinfo` | bottom:70 left:16 | WP actual / total + distancia |
| `hud-geofence` | bottom:70 right:16 | Estado geofence (INACTIVA / REC pulsante / CERRADA) |
| `hud-swarm` | bottom:160 right:16 | Estado enjambre (drones + ETA) |

#### Overlays adicionales
- **FPV overlay** — viñeta + scanlines + crosshair SVG + labels militares en esquinas + tinte verde NV
- **Mock badge** — pill ámbar centrado arriba "◉ MOCK TELEMETRY"
- **WS banner** — rojo arriba "Telemetría desconectada"
- **Gamepad banner** — ámbar top:60 "Gamepad no detectado"
- **Cam badge** — "◎ FOLLOW/ORBITAL/FPV" bottom-right

#### Barra de controles (derecha)
```
top:120 right:16, columna vertical:
⚙ AJUSTES | PNOA ON | ↺ FOLLOW | ← PLAN
```

#### Marcador del dron
SVG Predator en perspectiva 3D CSS:
- `drone-3d-tilt`: `perspective(82px) rotateX(40deg)` origin 50% 58%
- `drone-rot-wrapper`: rotación yaw controlada por JS
- Sombra elíptica en el suelo (blur 10px)
- LED parpadeante cuando armado

#### Modal Debrief
- Overlay blur:12px oscuro
- Card centrada 420–520px: título + zona + tabla 4 métricas (tiempo/focos/área/extinción) + estrellas + score animado (44px) + 2 botones

#### Modal Ajustes
- Dropdown desde top-right (no overlay completo)
- Tabla de controles mando + teclado en mono

**Problemas de diseño actuales:**
- El HUD inferior (`hud-bottom`) tiene demasiados elementos en horizontal → se superpone en pantallas <1400px
- La barra de controles de mapa (derecha) colisiona visualmente con el panel HUD topright
- El FPV overlay es muy bueno pero el crosshair podría ser más dramático
- Los paneles HUD tienen todos el mismo peso visual — sin jerarquía
- El modal de ajustes no tiene un diseño del mando real (sería mejor un diagrama visual)
- No hay feedback visual cuando el SITL está arrancando (silencioso)
- El debrief modal podría tener más dramatismo (animación de entrada más elaborada)

---

## 4. Componentes reutilizables existentes

### Badge de modo de vuelo
```
.mode-badge — border-radius 4px, flex row, dot + texto
Colores: verde (FBWA/CRUISE), azul (LOITER), ámbar (AUTO/RTL), rojo (MANUAL)
```

### HUD Panel base
```
background: rgba(10,10,10,0.72)
border: 1px solid rgba(255,255,255,0.08)  
border-radius: 6px
backdrop-filter: blur(8px)
font: JetBrains Mono, color: #00ff88
```

### Botón primario (planning)
```
padding: 12px 16px, border-radius: 6px
background: #e85d24 o #2da862
font: Inter 700, letter-spacing: 0.10em
```

### Botón HUD (simulator)
```
padding: 5px 10px, border-radius: 4px
border: 1px solid rgba(255,255,255,0.15)
background: rgba(255,255,255,0.05)
font: JetBrains Mono 11px 700
```

---

## 5. Áreas prioritarias de mejora

### Alta prioridad
1. **Indicador de carga del SITL** — cuando el dron está arrancando (~18s), no hay ningún feedback. Necesita un estado intermedio visible (spinner, barra de progreso, texto).
2. **HUD bottom reorganizado** — en pantallas medianas se corta. Posible solución: separar ARM/DISARM del resto, o hacerlo colapsable.
3. **Diagrama de mando en Ajustes** — en lugar de tabla de texto, un SVG del mando con anotaciones.

### Media prioridad
4. **Jerarquía visual en el HUD** — el panel de telemetría top-left es el más importante; debería ser más prominente. Actualmente todos los panels tienen el mismo tamaño visual.
5. **Estado de inicio de misión** — la transición planning → simulator es abrupt. Un estado de "preparando..." con animación sería mejor UX.
6. **Zone cards más diferenciadas** — cada zona podría tener un color de acento o icono propio.
7. **Splash más dramático** — el texto podría entrar con animación, el logo podría ser más grande.

### Baja prioridad
8. Sonidos (fase 10 del spec — no implementada aún)
9. Modo nocturno vs diurno del mapa
10. Efectos de partículas en el debrief

---

## 6. Restricciones técnicas para el diseño

- **Sin frameworks CSS** (no Tailwind, no Bootstrap). Solo CSS custom con variables.
- **Sin imágenes externas** (logos y elementos decorativos deben ser SVG inline o CSS puro).
- **Compatibilidad:** Chrome/Edge modernos. No IE, no Safari móvil.
- **El mapa es siempre el fondo** — los panels HUD deben ser semitransparentes (backdrop-filter).
- **JetBrains Mono es obligatorio** para datos numéricos de telemetría (legibilidad en tiempo real).
- **Animaciones JS**: posición del dron, horizonte artificial y capas de fuego se actualizan via JS a 5–50Hz. Los estilos CSS no deben interferir con el `transform` del marcador.

---

## 7. Guía de uso — Cómo usar Claude para diseño

### Opción A — claude.ai (recomendada para propuestas visuales)

1. **Abre** [claude.ai](https://claude.ai) y crea una nueva conversación
2. **Adjunta capturas de pantalla** de cada pantalla (F12 → screenshot en Chrome, o usa la herramienta de recorte de Windows)
3. **Pega este documento** completo en el chat
4. **Escribe tu prompt** de diseño. Ejemplos:

```
"Aquí tienes el brief de diseño de Galicia Wildfire y capturas de las 3 pantallas.
Quiero mejorar la pantalla del simulador. Propón:
1. Un nuevo layout para el HUD inferior que no se corte en 1366px de ancho
2. Un indicador de progreso de arranque del SITL (overlay semitransparente)
3. CSS listo para copiar y pegar, compatible con las variables CSS del brief"
```

```
"Basándote en el brief, rediseña el modal de Ajustes para mostrar un diagrama SVG
del mando Xbox con las acciones anotadas en lugar de la tabla de texto actual.
El SVG debe ser inline en el HTML, sin dependencias externas."
```

```
"Analiza la pantalla de planificación de la imagen adjunta.
¿Qué cambios de layout o color mejorarían la legibilidad del panel izquierdo?
Dame el CSS diferencial (solo los cambios, no el archivo completo)."
```

### Opción B — Claude Code (este entorno)

Describe el cambio y Claude lo implementa directamente en los archivos:

```
"Añade un overlay de carga al simulador: mientras startSITL() está haciendo polling,
muestra un panel semitransparente centrado con una barra de progreso que avanza
de 0 a 100% en 50 segundos, y el texto 'INICIALIZANDO SITL...'. Cuando
mavlink_mock sea false, el overlay desaparece con fade-out."
```

### Opción C — Exportar HTML para preview

```bash
# Servir el frontend localmente para hacer capturas de alta calidad:
cd c:/Users/Usuario/Desktop/GALICIA_WILDFIRE/frontend
python -m http.server 3000
# Abrir http://localhost:3000 en Chrome
# F12 → Cmd+Shift+P → "Capture full size screenshot"
```

---

## 8. Archivos de diseño relevantes

```
frontend/
├── index.html                          # Splash (punto de entrada)
├── pages/
│   ├── splash/
│   │   ├── splash.html
│   │   └── splash.css                  # Animaciones splash
│   ├── planning/
│   │   ├── index.html
│   │   └── planning.css               # Layout 2 col + zone cards
│   └── simulator/
│       ├── index.html                  # Todos los elementos HUD
│       └── simulator.css              # FPV, debrief, settings, mapa
└── components/
    └── hud/
        └── hud.css                    # Sistema HUD completo
```
