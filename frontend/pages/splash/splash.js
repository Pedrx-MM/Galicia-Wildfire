'use strict';
/**
 * Galicia Wildfire — Splash Screen
 * CSS + SVG inline + JS vanilla. Sin canvas, sin librerías, sin fetch al backend.
 *
 * Secuencia:
 *  1. Partículas de ceniza + chispas CSS (inmediato)
 *  2. Type-on del título (letra a letra)
 *  3. Subtítulo aparece en mono después
 *  4. Barra de progreso aparece y corre en 5 pasos (~3.1 s total)
 *  5. Al llegar a 100%: parpadeo "Sistema listo" → dron entra
 *  6. El dron vuela a ras de las copas de los árboles
 *  7. Al centrarse, suelta 6 gotas que caen hasta el fuego → splash + vapor
 *  8. Llamas se atenúan brevemente
 *  9. Wipe horizontal naranja → navega a planning
 */

// ─── Pasos de carga ───────────────────────────────────────────────────────────
const LOADING_STEPS = [
  { pct: 20,  msg: 'Inicializando sistema MAVLink...',   delay: 400 },
  { pct: 45,  msg: 'Cargando cartografía de Galicia...', delay: 900 },
  { pct: 70,  msg: 'Generando modelos de terreno...',    delay: 700 },
  { pct: 90,  msg: 'Calibrando simulador de vuelo...',   delay: 800 },
  { pct: 100, msg: 'Sistema listo',                      delay: 300 },
];

// ─── SVG del dron (ala fija, vista lateral) — MQ-9 Reaper operativo ──────────
// Vuelo izquierda → derecha: nariz a la derecha (alto X), cola a la izquierda.
// Hélice propulsora (pusher) en cola. Alas barridas hacia atrás. Livery militar.
const DRONE_SVG = `
<svg viewBox="0 0 240 72" width="240" height="72" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Cuerpo: gradiente gris metálico con reflejo superior -->
    <linearGradient id="sp-fuse" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#e8edf4"/>
      <stop offset="20%"  stop-color="#c5cdd9"/>
      <stop offset="55%"  stop-color="#9aa5b5"/>
      <stop offset="100%" stop-color="#5c6472"/>
    </linearGradient>
    <!-- Domo sensor / cabina -->
    <radialGradient id="sp-dome" cx="40%" cy="30%" r="70%">
      <stop offset="0%"   stop-color="#b8e5ff"/>
      <stop offset="40%"  stop-color="#4a7ab2"/>
      <stop offset="100%" stop-color="#1a2a45"/>
    </radialGradient>
    <!-- Ala -->
    <linearGradient id="sp-wing" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%"   stop-color="#c0c9d6"/>
      <stop offset="50%"  stop-color="#8894a5"/>
      <stop offset="100%" stop-color="#4a5566"/>
    </linearGradient>
    <!-- Glow del motor -->
    <radialGradient id="sp-heat" cx="50%" cy="50%" r="50%">
      <stop offset="0%"   stop-color="#ffb366" stop-opacity="0.95"/>
      <stop offset="50%"  stop-color="#ff4422" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#660000" stop-opacity="0"/>
    </radialGradient>
    <!-- Estela del escape caliente -->
    <linearGradient id="sp-exhaust" x1="0%" y1="50%" x2="100%" y2="50%">
      <stop offset="0%"   stop-color="#ffa060" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffa060" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- ── ESTELA DE CALOR (detrás de la cola, izquierda) ───────────── -->
  <ellipse cx="6" cy="36" rx="14" ry="3" fill="url(#sp-exhaust)" opacity="0.5"/>

  <!-- ── HÉLICE PUSHER EN COLA ──────────────────────────────────── -->
  <ellipse cx="18" cy="36" rx="2.5" ry="16" fill="rgba(200,210,225,0.28)"/>
  <ellipse cx="18" cy="36" rx="1.2" ry="16" fill="rgba(255,255,255,0.18)"/>
  <circle  cx="18" cy="36" r="3.4" fill="#2a323e" stroke="#11161e" stroke-width="0.7"/>

  <!-- ── ESTABILIZADORES DE COLA ────────────────────────────────── -->
  <!-- Estabilizador horizontal superior -->
  <polygon points="34,32 16,22 13,28 33,33" fill="url(#sp-wing)" stroke="#2a323e" stroke-width="0.6"/>
  <!-- Estabilizador horizontal inferior -->
  <polygon points="34,40 16,50 13,44 33,39" fill="url(#sp-wing)" stroke="#2a323e" stroke-width="0.6"/>
  <!-- Aleta vertical superior (V-tail característica) -->
  <polygon points="30,33 22,14 26,14 34,33" fill="#8894a5" stroke="#2a323e" stroke-width="0.7"/>
  <polygon points="30,39 22,58 26,58 34,39" fill="#6c778a" stroke="#2a323e" stroke-width="0.6"/>

  <!-- ── FUSELAJE PRINCIPAL ────────────────────────────────────── -->
  <!-- Cuerpo torpedo: cola estrecha, centro grueso, nariz afilada -->
  <path d="M232,36
           Q220,29 195,28 L120,27
           Q70,28 30,30
           Q24,32 22,36
           Q24,40 30,42 L120,45
           Q195,44 220,43 Z"
        fill="url(#sp-fuse)" stroke="#2a323e" stroke-width="0.9"/>

  <!-- Spine (highlight dorsal del cilindro) -->
  <path d="M30,32 L200,31 Q215,32 225,35 L200,33 L30,33 Z"
        fill="rgba(255,255,255,0.35)"/>

  <!-- Líneas de panel -->
  <line x1="60"  y1="31.5" x2="180" y2="30.5" stroke="rgba(30,40,55,0.4)" stroke-width="0.5"/>
  <line x1="60"  y1="40.5" x2="180" y2="41.5" stroke="rgba(30,40,55,0.4)" stroke-width="0.5"/>
  <line x1="100" y1="28"   x2="100" y2="44"   stroke="rgba(30,40,55,0.35)" stroke-width="0.5"/>
  <line x1="150" y1="28"   x2="150" y2="44"   stroke="rgba(30,40,55,0.35)" stroke-width="0.5"/>

  <!-- Livery / número identificador -->
  <text x="90" y="39" font-family="JetBrains Mono, monospace" font-size="5.2" font-weight="700"
        fill="rgba(30,40,55,0.65)" letter-spacing="0.4">GW-01</text>

  <!-- Roundel / estrella (pequeño distintivo) -->
  <circle cx="135" cy="36" r="2.6" fill="#1a2a45" opacity="0.85"/>
  <circle cx="135" cy="36" r="1.4" fill="#e85d24" opacity="0.9"/>

  <!-- ── ALAS (barridas hacia atrás) ───────────────────────────── -->
  <!-- Ala superior -->
  <polygon points="140,29 86,7 62,11 128,29"
           fill="url(#sp-wing)" stroke="#2a323e" stroke-width="0.85"/>
  <!-- Borde de ataque superior (highlight) -->
  <polygon points="140,29 86,7 88,9 138,29"
           fill="rgba(255,255,255,0.22)"/>
  <!-- Winglet superior -->
  <polygon points="62,11 56,6 60,14" fill="#6c778a" stroke="#2a323e" stroke-width="0.5"/>
  <!-- Detalle de pylón en ala superior (carga) -->
  <rect x="92" y="14" width="3" height="5" rx="0.5" fill="#3a424e" stroke="#1a1f28" stroke-width="0.3"/>
  <rect x="105" y="12" width="3" height="5" rx="0.5" fill="#3a424e" stroke="#1a1f28" stroke-width="0.3"/>

  <!-- Ala inferior -->
  <polygon points="140,43 86,65 62,61 128,43"
           fill="url(#sp-wing)" stroke="#2a323e" stroke-width="0.85"/>
  <!-- Sombra de borde de salida (inferior) -->
  <polygon points="128,43 62,61 64,63 130,44"
           fill="rgba(30,40,55,0.35)"/>
  <!-- Winglet inferior -->
  <polygon points="62,61 56,66 60,58" fill="#6c778a" stroke="#2a323e" stroke-width="0.5"/>
  <!-- Detalle de pylón en ala inferior (carga) -->
  <rect x="92" y="53" width="3" height="5" rx="0.5" fill="#3a424e" stroke="#1a1f28" stroke-width="0.3"/>
  <rect x="105" y="55" width="3" height="5" rx="0.5" fill="#3a424e" stroke="#1a1f28" stroke-width="0.3"/>

  <!-- ── ANTENA SATCOM DORSAL ─────────────────────────────────── -->
  <rect x="160" y="22" width="3" height="10" rx="1" fill="#2a323e" stroke="#11161e" stroke-width="0.4"/>
  <rect x="158" y="27" width="7" height="1.5" rx="0.4" fill="#1a1f28"/>

  <!-- ── NARIZ SENSORA ────────────────────────────────────────── -->
  <!-- Domo sensor bajo el morro -->
  <ellipse cx="210" cy="42" rx="7" ry="5" fill="url(#sp-dome)" stroke="#11161e" stroke-width="0.7"/>
  <ellipse cx="208" cy="40" rx="2.5" ry="1.5" fill="rgba(255,255,255,0.55)"/>
  <circle  cx="210" cy="43" r="2" fill="rgba(0,0,0,0.75)"/>
  <circle  cx="209.3" cy="42.2" r="0.7" fill="rgba(140,200,255,0.75)"/>

  <!-- ── NARIZ PUNTIAGUDA ─────────────────────────────────────── -->
  <path d="M225,32 Q236,34 238,36 Q236,38 225,40 Z"
        fill="url(#sp-fuse)" stroke="#2a323e" stroke-width="0.6"/>

  <!-- Pitot tube -->
  <rect x="237" y="35.5" width="3" height="1" fill="#11161e"/>

  <!-- ── LUCES DE NAVEGACIÓN ─────────────────────────────────── -->
  <!-- Luz de nariz -->
  <circle cx="234" cy="36" r="1.5" fill="#ffffff" opacity="0.95">
    <animate attributeName="opacity" values="0.95;0.4;0.95" dur="1.2s" repeatCount="indefinite"/>
  </circle>
  <!-- Luz estroboscópica ala superior (verde) -->
  <circle cx="60" cy="9" r="1.8" fill="#44ee88" opacity="0.9">
    <animate attributeName="opacity" values="1;0.15;1" dur="0.9s" repeatCount="indefinite"/>
  </circle>
  <!-- Luz estroboscópica ala inferior (rojo) -->
  <circle cx="60" cy="63" r="1.8" fill="#ff4455" opacity="0.9">
    <animate attributeName="opacity" values="1;0.15;1" dur="0.9s" repeatCount="indefinite" begin="0.4s"/>
  </circle>
  <!-- Beacon dorsal rojo pulsante -->
  <circle cx="162" cy="20" r="1.1" fill="#ff6644" opacity="0.95">
    <animate attributeName="opacity" values="1;0.1;1" dur="1.4s" repeatCount="indefinite"/>
  </circle>

  <!-- ── BRILLO DEL MOTOR EN COLA ─────────────────────────────── -->
  <circle cx="16" cy="36" r="5" fill="url(#sp-heat)"/>
</svg>`;

// ─── Refs DOM ─────────────────────────────────────────────────────────────────
const splashEl     = document.getElementById('splash');
const progressSect = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const statusText   = document.getElementById('statusText');
const ashLayer     = document.getElementById('ashLayer');
const droneWrapper = document.getElementById('droneWrapper');
const titleMain    = document.querySelector('.title-main');
const titleSub     = document.querySelector('.title-sub');

// ─── 1. Partículas de ceniza + chispas de fuego ──────────────────────────────
function spawnAshParticles() {
  // Ceniza blanca (60)
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'ash-particle';
    const size   = 1.2 + Math.random() * 2.8;
    const driftX = (Math.random() - 0.5) * 80;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random() * 100}%;
      bottom:0;
      --drift-x:${driftX}px;
      animation-duration:${13 + Math.random() * 20}s;
      animation-delay:${Math.random() * -22}s;
      opacity:${0.10 + Math.random() * 0.22};
    `;
    ashLayer.appendChild(p);
  }
  // Chispas naranjas (20)
  for (let i = 0; i < 20; i++) {
    const s = document.createElement('div');
    s.className = 'ash-particle ember';
    const size   = 1.4 + Math.random() * 1.6;
    const driftX = (Math.random() - 0.5) * 50;
    s.style.cssText = `
      width:${size}px; height:${size}px;
      left:${30 + Math.random() * 40}%;
      bottom:0;
      --drift-x:${driftX}px;
      animation-duration:${7 + Math.random() * 9}s;
      animation-delay:${Math.random() * -12}s;
      opacity:${0.55 + Math.random() * 0.4};
    `;
    ashLayer.appendChild(s);
  }
}

// ─── 2. Type-on del título ────────────────────────────────────────────────────
function typeOnTitle() {
  const text = titleMain.dataset.text || titleMain.textContent;
  titleMain.dataset.text = text;
  titleMain.textContent  = '';
  titleMain.classList.add('typing');

  let i = 0;
  const caret = document.createElement('span');
  caret.className = 'title-caret';
  caret.textContent = '▌';
  titleMain.appendChild(caret);

  const tick = () => {
    if (i >= text.length) {
      setTimeout(() => caret.remove(), 700);
      // Subtítulo "boot" en mono
      setTimeout(showSubtitle, 250);
      return;
    }
    const ch = document.createTextNode(text[i]);
    titleMain.insertBefore(ch, caret);
    i++;
    setTimeout(tick, 42 + Math.random() * 28);
  };
  tick();
}

function showSubtitle() {
  titleSub.classList.add('visible');
  // Barra de progreso entra justo después
  setTimeout(() => {
    progressSect.classList.add('visible');
    runLoadingSequence();
  }, 420);
}

// ─── 3. Progreso ──────────────────────────────────────────────────────────────
function setProgress(pct, msg) {
  progressFill.style.width = pct + '%';
  statusText.textContent = msg;
}

function runLoadingSequence() {
  let idx = 0;
  function nextStep() {
    if (idx >= LOADING_STEPS.length) return;
    const step = LOADING_STEPS[idx++];
    setTimeout(() => {
      setProgress(step.pct, step.msg);
      if (step.pct === 100) {
        setTimeout(blinkReadyAndLaunch, 500);
      } else {
        nextStep();
      }
    }, step.delay);
  }
  nextStep();
}

// ─── 4. Parpadeo "Sistema listo" ──────────────────────────────────────────────
function blinkReadyAndLaunch() {
  const blink = (times, cb) => {
    if (times <= 0) { cb(); return; }
    statusText.style.opacity = '0.35';
    setTimeout(() => {
      statusText.style.opacity = '1';
      setTimeout(() => blink(times - 1, cb), 170);
    }, 170);
  };
  blink(2, launchDrone);
}

// ─── 5. Animación del dron ────────────────────────────────────────────────────
function launchDrone() {
  const logoEl   = document.querySelector('.logo-svg');
  const logoRect = logoEl.getBoundingClientRect();

  const DRONE_H     = 72;
  const flameTipY   = logoRect.top + logoRect.height * 0.07;
  const droneTopY   = flameTipY - DRONE_H + 8;
  const droneBottomY = droneTopY + DRONE_H;

  const fireZoneY   = logoRect.top + logoRect.height * 0.40;
  const fallDist    = fireZoneY - droneBottomY;

  const container = document.createElement('div');
  container.className = 'drone-svg-container';
  container.innerHTML = DRONE_SVG;
  container.style.top  = droneTopY + 'px';
  container.style.left = '0px';
  droneWrapper.appendChild(container);

  container.getBoundingClientRect();
  container.classList.add('flying');

  setTimeout(() => releaseWaterDrops(droneBottomY, logoRect, fallDist), 650);

  // Fin del cruce → wipe
  setTimeout(startWipe, 1500);
}

// ─── 6. Gotas de agua + efectos ───────────────────────────────────────────────
function releaseWaterDrops(startY, logoRect, fallDist) {
  const logoCenter = logoRect.left + logoRect.width / 2;

  const xOffsets = [-55, -33, -12, 12, 33, 55];
  const dropDur  = 0.82;

  xOffsets.forEach((dx, i) => {
    const drop = document.createElement('div');
    drop.className = 'water-drop';
    const skew = dx * 0.08;
    drop.style.cssText = `
      left: ${logoCenter + dx}px;
      top:  ${startY}px;
      --drop-fall: ${fallDist}px;
      --drop-dx:   ${skew}px;
      animation-delay: ${i * 0.06}s;
      animation-duration: ${dropDur}s;
    `;
    splashEl.appendChild(drop);

    const landDelay = (dropDur + i * 0.06) * 1000;
    setTimeout(() => {
      const landX = logoCenter + dx + skew;
      const landY = startY + fallDist;
      createSplash(landX, landY);
      createSteam(landX, landY);
    }, landDelay);
  });

  setTimeout(() => createDouseFlash(logoCenter, startY + fallDist * 0.5, logoRect.width * 0.8), 600);
  douseFlames(900);
}

function createSplash(x, y) {
  const el = document.createElement('div');
  el.className = 'water-splash';
  el.style.cssText = `left:${x}px; top:${y}px;`;
  splashEl.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

function createSteam(x, y) {
  const count = 3;
  for (let i = 0; i < count; i++) {
    const puff = document.createElement('div');
    puff.className = 'steam-puff';
    const dxRand = (Math.random() - 0.5) * 24;
    puff.style.cssText = `
      left:${x + (Math.random() - 0.5) * 16}px;
      top:${y - 2}px;
      --steam-dx:${dxRand}px;
      animation-delay:${i * 0.09}s;
    `;
    splashEl.appendChild(puff);
    setTimeout(() => puff.remove(), 900);
  }
}

function createDouseFlash(cx, cy, size) {
  const el = document.createElement('div');
  el.className = 'douse-flash';
  el.style.cssText = `
    left:${cx - size / 2}px;
    top:${cy - size / 2}px;
    width:${size}px;
    height:${size}px;
  `;
  splashEl.appendChild(el);
  setTimeout(() => el.remove(), 500);
}

function douseFlames(duration) {
  const logoSvg = document.querySelector('.logo-svg');
  logoSvg.classList.add('water-hit');
  setTimeout(() => logoSvg.classList.remove('water-hit'), duration);
}

// ─── 7. Wipe horizontal naranja → navegación ──────────────────────────────────
function startWipe() {
  // Crear dos barras que entran desde los lados
  const wipe = document.createElement('div');
  wipe.className = 'splash-wipe';
  wipe.innerHTML = `
    <div class="wipe-bar wipe-bar-top"></div>
    <div class="wipe-bar wipe-bar-bot"></div>
  `;
  document.body.appendChild(wipe);

  // Después de 0.55s las barras cubren y navegamos
  setTimeout(() => {
    window.location.href = '../planning/index.html';
  }, 620);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  spawnAshParticles();
  // Type-on comienza después de 500ms (deja ver las llamas primero)
  setTimeout(typeOnTitle, 500);
});
