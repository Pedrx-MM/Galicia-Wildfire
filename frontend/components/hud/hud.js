'use strict';
/**
 * Galicia Wildfire — HUD (Heads-Up Display)
 * Spec §13 — CSS puro sobre el mapa, sin canvas.
 * Operations Console: compass tape + vertical tapes + throttle + attitude ring.
 * Todos los paneles se actualizan con update(telemetryData).
 */

/* ─── Constantes de las cintas ───────────────────────────────────────────── */
const COMPASS_PX_PER_DEG = 8;     // ancho de cada tick de 1° en la cinta
const VTAPE_ALT_PX_PER_M = 2.2;   // altitud: 1 m = 2.2 px
const VTAPE_SPD_PX_PER_KMH = 3;   // velocidad: 1 km/h = 3 px

class HUD {
  /**
   * @param {object} elements  — Mapa de ids/refs DOM
   */
  constructor(elements) {
    this._el = elements;
    this._lastArmed = null;
    this._windDirDeg = 0;     // dirección del viento (meteorológica: FROM)
    this._lastHeading = 0;
    this._buildCompassTape();
    this._buildVTape('alt');
    this._buildVTape('speed');
  }

  /* ══════════════════════════════════════════════════════════════════════
     CONSTRUCCIÓN DE LAS CINTAS (una sola vez)
     ══════════════════════════════════════════════════════════════════════ */

  _buildCompassTape() {
    const strip = this._el.compassStrip;
    if (!strip) return;
    const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const SEMI = { 45: 'NE', 135: 'SE', 225: 'SW', 315: 'NW' };
    const frag = document.createDocumentFragment();

    // Dos vueltas (-180° a +540°) para que la cinta nunca muestre hueco
    for (let deg = -180; deg <= 540; deg += 5) {
      const norm = ((deg % 360) + 360) % 360;
      const tick = document.createElement('div');
      tick.className = 'compass-tick';
      if (norm in CARD) {
        tick.classList.add('major', 'cardinal');
        tick.textContent = CARD[norm];
      } else if (norm in SEMI) {
        tick.classList.add('major');
        tick.textContent = SEMI[norm];
      } else if (norm % 30 === 0) {
        tick.classList.add('major');
        tick.textContent = String(norm).padStart(3, '0');
      }
      frag.appendChild(tick);
    }
    strip.appendChild(frag);
    // Centrar la cinta en 0° inicialmente
    strip.style.transform = `translateX(${-180 * COMPASS_PX_PER_DEG}px)`;
  }

  _buildVTape(kind) {
    const strip = kind === 'alt' ? this._el.vtapeAltStrip : this._el.vtapeSpeedStrip;
    if (!strip) return;
    const frag = document.createDocumentFragment();
    const step  = 10;                                    // paso 10 m / 10 km/h
    const count = kind === 'alt' ? 80 : 40;              // 0..800 m / 0..400 km/h
    const pxPer = kind === 'alt' ? VTAPE_ALT_PX_PER_M : VTAPE_SPD_PX_PER_KMH;
    const tickH = step * pxPer;                          // altura de cada tick

    for (let i = 0; i <= count; i++) {
      const val = i * step;
      const tick = document.createElement('div');
      tick.className = 'vtape-tick';
      if (i % 5 === 0) tick.classList.add('major');
      if (i % 5 === 0) tick.textContent = val.toString();
      // Posicionado absolutamente: value=V aparece V*pxPer pixels encima del fondo del strip
      tick.style.position = 'absolute';
      tick.style.left  = '0';
      tick.style.right = '0';
      tick.style.bottom = `${val * pxPer - tickH / 2}px`;
      tick.style.height = `${tickH}px`;
      frag.appendChild(tick);
    }
    strip.appendChild(frag);
  }

  /* ══════════════════════════════════════════════════════════════════════
     UPDATE PRINCIPAL
     ══════════════════════════════════════════════════════════════════════ */

  update(data) {
    this._updateSpeedAltHdg(data);
    this._updateAttitude(data);
    this._updateMode(data);
    this._updateCompassTape(data);
    this._updateVTapes(data);
    this._updateThrottle(data);
    this._updateWindPip();
  }

  /* ─── Panel superior izquierdo ─────────────────────────────────────── */
  _updateSpeedAltHdg(data) {
    const e = this._el;
    if (e.ias)  e.ias.textContent  = Math.round(data.airspeed * 3.6);    // m/s → km/h
    if (e.alt)  e.alt.textContent  = Math.round(data.alt_rel);
    if (e.hdg)  e.hdg.textContent  = Math.round(data.yaw).toString().padStart(3, '0');
    if (e.vspd) e.vspd.textContent = (data.vertical_speed >= 0 ? '+' : '') + data.vertical_speed.toFixed(1);
    if (e.gspd) e.gspd.textContent = Math.round(data.groundspeed * 3.6);
  }

  /* ─── Horizonte artificial ─────────────────────────────────────────── */
  _updateAttitude(data) {
    const inner = this._el.attitudeInner;
    if (!inner) return;

    const roll  = data.roll  ?? 0;
    const pitch = data.pitch ?? 0;
    const pitchOffset = pitch * 1.2;

    inner.style.transform = `rotate(${roll}deg) translateY(${pitchOffset}px)`;
    if (this._el.rollVal)  this._el.rollVal.textContent  = roll.toFixed(1)  + '°';
    if (this._el.pitchVal) this._el.pitchVal.textContent = pitch.toFixed(1) + '°';
  }

  /* ─── Badge modo + arm + WP ────────────────────────────────────────── */
  _updateMode(data) {
    const e = this._el;

    if (e.modeBadge && data.mode) {
      const modeKey = data.mode.toLowerCase().replace(/ /g, '_');
      e.modeBadge.className = `mode-badge mode-${modeKey}`;
      const modeText = e.modeBadge.querySelector('.mode-text');
      if (modeText) modeText.textContent = data.mode;
    }

    if (e.armBadge) {
      e.armBadge.className = `arm-badge ${data.armed ? 'armed' : 'disarmed'}`;
      e.armBadge.textContent = data.armed ? '● ARMADO' : '○ DESARMADO';
    }

    if (e.btnArm) {
      if (data.armed) {
        e.btnArm.textContent = 'DISARM';
        e.btnArm.className   = 'hud-btn btn-disarm';
      } else {
        e.btnArm.textContent = 'ARM';
        e.btnArm.className   = 'hud-btn btn-arm';
      }
    }

    if (data.armed !== this._lastArmed) {
      this._lastArmed = data.armed;
      if (this._el.onArmedChange) this._el.onArmedChange(data.armed);
    }

    if (e.wpNum)   e.wpNum.textContent   = data.wp_num ?? '—';
    if (e.wpDist)  e.wpDist.textContent  = Math.round(data.wp_dist ?? 0) + ' m';
    if (e.wpTotal) e.wpTotal.textContent = data.mission_total ?? '—';
  }

  /* ─── Compass tape ─────────────────────────────────────────────────── */
  _updateCompassTape(data) {
    const yaw = ((data.yaw ?? 0) + 360) % 360;
    this._lastHeading = yaw;

    if (this._el.compassStrip) {
      // La cinta tiene ticks desde -180°. Para centrar el yaw bajo el índice
      // desplazamos la cinta -yaw*pxPerDeg (relativo a offset inicial de -180°).
      const shift = -(yaw + 180) * COMPASS_PX_PER_DEG;
      this._el.compassStrip.style.transform = `translateX(${shift}px)`;
    }

    if (this._el.compassHeadingLabel) {
      this._el.compassHeadingLabel.textContent = Math.round(yaw).toString().padStart(3, '0') + '°';
    }
  }

  /* ─── V-tapes: altitud y velocidad ─────────────────────────────────── */
  _updateVTapes(data) {
    const e = this._el;
    const alt = Math.max(0, data.alt_rel ?? 0);
    const ias = Math.max(0, (data.airspeed ?? 0) * 3.6);

    if (e.vtapeAltStrip) {
      // Mover la cinta hacia abajo (valores pequeños bajan) según altitud actual
      e.vtapeAltStrip.style.transform = `translateY(${alt * VTAPE_ALT_PX_PER_M}px)`;
    }
    if (e.vtapeAltValue) e.vtapeAltValue.textContent = Math.round(alt);

    if (e.vtapeSpeedStrip) {
      e.vtapeSpeedStrip.style.transform = `translateY(${ias * VTAPE_SPD_PX_PER_KMH}px)`;
    }
    if (e.vtapeSpeedValue) e.vtapeSpeedValue.textContent = Math.round(ias);
  }

  /* ─── Throttle bar ─────────────────────────────────────────────────── */
  _updateThrottle(data) {
    // ArduPlane expone throttle como parte de VFR_HUD (%); si falta, inferir de airspeed
    let pct = data.throttle;
    if (pct === undefined || pct === null) {
      // Estimación: 0→60 km/h ≈ 0→100 %
      pct = Math.min(100, Math.max(0, ((data.airspeed ?? 0) * 3.6 / 60) * 100));
    }
    pct = Math.max(0, Math.min(100, pct));
    if (this._el.throttleFill)  this._el.throttleFill.style.height = pct + '%';
    if (this._el.throttleValue) this._el.throttleValue.textContent = Math.round(pct) + '%';
  }

  /* ─── Wind pip sobre el compass tape ──────────────────────────────── */
  _updateWindPip() {
    const pip = this._el.compassWindPip;
    if (!pip) return;
    // Posición relativa del viento respecto al heading actual
    // Viento "FROM" → el pip indica de dónde viene
    let rel = this._windDirDeg - this._lastHeading;
    rel = ((rel + 540) % 360) - 180;   // normalizado a [-180, 180]
    // Clamp: solo se muestra si está dentro del rango visible de la cinta
    const half = 280;   // ~35° visibles a cada lado (560px ancho / 2)
    const px = rel * COMPASS_PX_PER_DEG;
    if (Math.abs(px) > half) {
      pip.style.opacity = '0';
    } else {
      pip.style.opacity = '1';
      pip.style.left = `calc(50% + ${px}px)`;
    }
  }

  /* ─── Viento (estático desde gameState) ────────────────────────────── */
  setWind(direction_deg, speed_kmh) {
    this._windDirDeg = direction_deg ?? 0;
    const e = this._el;
    if (e.windDir)   e.windDir.textContent   = Math.round(direction_deg) + '°';
    if (e.windSpeed) e.windSpeed.textContent = Math.round(speed_kmh) + ' km/h';
  }
}

window.HUD = HUD;
