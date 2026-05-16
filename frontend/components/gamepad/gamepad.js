'use strict';
/**
 * Galicia Wildfire — Gamepad Controller
 * Spec §8 — Mapeo Xbox / Nacon PC Controller → RC channels ArduPlane.
 *
 * Fix Nacon: el evento gamepadconnected en Chrome solo dispara cuando el usuario
 * pulsa un botón por primera vez. Añadimos scan periódico para detectar el mando
 * aunque ya esté conectado antes de abrir la página.
 *
 * Throttle combinado L2 + R2 (no spring-back, acumula delta).
 * Deadzone ±0.08, suavizado 0.7/0.3, polling 50 Hz.
 * D-pad: buttons[12-15] o axes[6/7] (HAT switch — varía por controlador).
 * Keyboard fallback activo siempre.
 */

class GamepadController {
  /**
   * @param {function} onRC       — callback({ ch1, ch2, ch3, ch4 }) en µs
   * @param {function} onButton   — callback(action: string)
   * @param {function} onConnect  — callback(connected: bool, name: string)
   * @param {function} onDpad     — callback({ up, down, left, right }) continuo mientras se mantiene
   */
  constructor({ onRC, onButton, onConnect, onDpad } = {}) {
    this._onRC      = onRC      ?? (() => {});
    this._onButton  = onButton  ?? (() => {});
    this._onConnect = onConnect ?? (() => {});
    this._onDpad    = onDpad    ?? (() => {});

    this._gamepadIndex = -1;
    this._pollTimer    = null;
    this._scanTimer    = null;
    this._connected    = false;

    // Estado RC (µs)
    this._rc     = { ch1: 1500, ch2: 1500, ch3: 1000, ch4: 1500 };
    this._rcPrev = { ...this._rc };
    this._smoothed    = {};
    this._prevButtons = {};
    this._lastTs      = performance.now();

    // Teclado fallback
    this._keys = {};
    this._bindKeyboard();

    // Listeners de conexión/desconexión
    window.addEventListener('gamepadconnected',    this._onGamepadConnected.bind(this));
    window.addEventListener('gamepaddisconnected', this._onGamepadDisconnected.bind(this));

    // ── FIX NACON: scan periódico ────────────────────────────────────────────
    // Chrome no emite gamepadconnected si el mando estaba conectado antes de abrir
    // la página hasta que el usuario pulsa un botón. Escaneamos cada 800 ms.
    this._detectExisting();
    this._scanTimer = setInterval(() => this._detectExisting(), 800);
  }

  // ─── Detección ──────────────────────────────────────────────────────────────

  _detectExisting() {
    if (this._connected) return;   // ya tenemos mando
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad && pad.connected) {
        this._gamepadIndex = pad.index;
        this._connected    = true;
        clearInterval(this._scanTimer);   // ya no necesitamos escanear
        this._onConnect(true, pad.id);
        this._startPolling();
        console.log('[Gamepad] Detectado (scan):', pad.id, 'axes:', pad.axes.length, 'buttons:', pad.buttons.length);
        return;
      }
    }
  }

  _onGamepadConnected(e) {
    if (this._connected) return;   // ignorar si ya tenemos uno
    const pad = e.gamepad;
    this._gamepadIndex = pad.index;
    this._connected    = true;
    clearInterval(this._scanTimer);
    this._onConnect(true, pad.id);
    this._startPolling();
    console.log('[Gamepad] Conectado (evento):', pad.id, 'axes:', pad.axes.length, 'buttons:', pad.buttons.length);
  }

  _onGamepadDisconnected(e) {
    if (e.gamepad.index !== this._gamepadIndex) return;
    console.log('[Gamepad] Desconectado:', e.gamepad.id);
    this._connected    = false;
    this._gamepadIndex = -1;
    this._onConnect(false, '');
    this._stopPolling();
    // Reiniciar scan para detectar reconexión
    this._scanTimer = setInterval(() => this._detectExisting(), 800);
  }

  get connected() { return this._connected; }

  /** Fuerza un re-scan manual (botón en UI) */
  scan() {
    this._detectExisting();
  }

  // ─── Polling 50 Hz ──────────────────────────────────────────────────────────

  _startPolling() {
    if (this._pollTimer) return;
    this._lastTs   = performance.now();
    this._pollTimer = setInterval(() => this._poll(), 20);
  }

  _stopPolling() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._smoothed  = {};
  }

  _poll() {
    const now = performance.now();
    const dt  = Math.min((now - this._lastTs) / 1000, 0.1);
    this._lastTs = now;

    const pads = navigator.getGamepads();
    const gp   = pads[this._gamepadIndex];
    if (!gp || !gp.connected) {
      // Mando desconectado silenciosamente (sin evento)
      this._connected = false;
      this._onConnect(false, '');
      this._stopPolling();
      this._scanTimer = setInterval(() => this._detectExisting(), 800);
      return;
    }

    const axes    = gp.axes;
    const buttons = gp.buttons;

    // ── Ejes de vuelo ────────────────────────────────────────────────────────
    // Mapeo estándar Xbox / Nacon (Standard Gamepad Mapping)
    // ch1=aileron, ch2=elevator, ch3=throttle, ch4=rudder
    const rollRaw  = this._dz(axes[0] ?? 0);
    const pitchRaw = this._dz(axes[1] ?? 0);
    const rudRaw   = this._dz(axes[2] ?? 0);

    const roll   = this._smooth('roll',  rollRaw);
    const pitch  = this._smooth('pitch', pitchRaw);
    const rudder = this._smooth('rud',   rudRaw);

    this._rc.ch1 = Math.round(1500 + roll   * 500);
    this._rc.ch2 = Math.round(1500 + pitch  * 500);
    this._rc.ch4 = Math.round(1500 + rudder * 500);

    // ── Throttle L2 + R2 (spec §8.3) ─────────────────────────────────────────
    // En Nacon: triggers suelen estar en axes[3]/axes[4] (0→-1 sin pulsar, 0→1 pulsado)
    // En Xbox:  axes[4]=L2, axes[5]=R2 (-1 sin pulsar, 1 pulsado)
    // Probamos ambos: si hay axes[5] y axes[4] usamos esos; si no, usamos axes[2]/axes[3]
    let r2Raw, l2Raw;
    if (axes.length >= 6) {
      r2Raw = axes[5] ?? -1;
      l2Raw = axes[4] ?? -1;
    } else if (axes.length >= 5) {
      r2Raw = axes[4] ?? -1;
      l2Raw = axes[3] ?? -1;
    } else {
      // Triggers como buttons[7]/[6] (digital)
      r2Raw = (buttons[7]?.pressed ? 1 : -1);
      l2Raw = (buttons[6]?.pressed ? 1 : -1);
    }
    const r2 = this._smooth('r2', (r2Raw + 1) / 2);
    const l2 = this._smooth('l2', (l2Raw + 1) / 2);
    const thrDelta = (r2 - l2) * 500 * dt;
    this._rc.ch3 = this._clamp(this._rc.ch3 + thrDelta, 1000, 2000);

    // ── D-pad (buttons[12-15] o HAT axes[6/7]) ───────────────────────────────
    const dpadUp    = (buttons[12]?.pressed) || (axes[7] !== undefined && axes[7] < -0.5);
    const dpadDown  = (buttons[13]?.pressed) || (axes[7] !== undefined && axes[7] > 0.5);
    const dpadLeft  = (buttons[14]?.pressed) || (axes[6] !== undefined && axes[6] < -0.5);
    const dpadRight = (buttons[15]?.pressed) || (axes[6] !== undefined && axes[6] > 0.5);

    if (dpadUp || dpadDown || dpadLeft || dpadRight) {
      this._onDpad({ up: dpadUp, down: dpadDown, left: dpadLeft, right: dpadRight });
    }

    // ── Botones (flanco subida) ──────────────────────────────────────────────
    const btnMap = {
      0:  'mode_fbwa',        // A / Cruz      — loiter/estabilizar
      1:  'disarm',           // B / Círculo   — DESARMAR
      2:  'mode_cruise',      // X / Cuadrado  — crucero
      3:  'arm',              // Y / Triángulo — ARMAR
      4:  'geofence_close',   // L1 / LB       — cerrar geofence
      5:  'geofence_vertex',  // R1 / RB       — añadir vértice
      8:  'start_mission',    // SELECT / BACK — INICIAR MISIÓN
      9:  'mode_rtl',         // START / Menu  — RTL
      10: 'camera_cycle',     // R3 (click)    — ciclar cámara
    };

    for (const [idx, action] of Object.entries(btnMap)) {
      const pressed = buttons[+idx]?.pressed ?? false;
      if (pressed && !this._prevButtons[idx]) {
        this._onButton(action);
      }
      this._prevButtons[idx] = pressed;
    }

    // ── Enviar RC si hubo cambio significativo (>15 µs) ──────────────────────
    if (this._rcChanged()) {
      this._onRC({ ...this._rc });
      this._rcPrev = { ...this._rc };
    }
  }

  // ─── Utilidades ─────────────────────────────────────────────────────────────

  _dz(val, dz = 0.08) {
    if (Math.abs(val) < dz) return 0;
    return (val - Math.sign(val) * dz) / (1 - dz);
  }

  _smooth(key, val) {
    this._smoothed[key] = (this._smoothed[key] ?? val) * 0.7 + val * 0.3;
    return this._smoothed[key];
  }

  _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  _rcChanged() {
    return Math.abs(this._rc.ch1 - this._rcPrev.ch1) > 15
        || Math.abs(this._rc.ch2 - this._rcPrev.ch2) > 15
        || Math.abs(this._rc.ch3 - this._rcPrev.ch3) > 15
        || Math.abs(this._rc.ch4 - this._rcPrev.ch4) > 15;
  }

  // ─── Keyboard fallback ───────────────────────────────────────────────────────

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this._keys[e.code] = true;
      if (e.code === 'Space')     { e.preventDefault(); this._onButton('arm'); }
      if (e.code === 'Backspace') { e.preventDefault(); this._onButton('disarm'); }
      if (e.code === 'KeyF')    this._onButton('mode_fbwa');
      if (e.code === 'KeyC')    this._onButton('mode_cruise');
      if (e.code === 'KeyR')    this._onButton('mode_rtl');
      if (e.code === 'KeyV')    this._onButton('camera_cycle');
      // D-pad simulado con teclado en numpad
      if (e.code === 'Numpad8') this._onDpad({ up: true,  down: false, left: false, right: false });
      if (e.code === 'Numpad2') this._onDpad({ up: false, down: true,  left: false, right: false });
      if (e.code === 'Numpad4') this._onDpad({ up: false, down: false, left: true,  right: false });
      if (e.code === 'Numpad6') this._onDpad({ up: false, down: false, left: false, right: true  });
    });
    window.addEventListener('keyup', (e) => { this._keys[e.code] = false; });

    setInterval(() => this._pollKeyboard(), 20);
  }

  _pollKeyboard() {
    const K = this._keys;
    let changed = false;

    const roll  = (K['KeyD'] ? 1 : 0) - (K['KeyA'] ? 1 : 0);
    const pitch = (K['KeyS'] ? 1 : 0) - (K['KeyW'] ? 1 : 0);
    const rud   = (K['ArrowRight'] ? 1 : 0) - (K['ArrowLeft'] ? 1 : 0);

    const ch1 = Math.round(1500 + roll  * 400);
    const ch2 = Math.round(1500 + pitch * 400);
    const ch4 = Math.round(1500 + rud   * 400);

    if (ch1 !== this._rc.ch1) { this._rc.ch1 = ch1; changed = true; }
    if (ch2 !== this._rc.ch2) { this._rc.ch2 = ch2; changed = true; }
    if (ch4 !== this._rc.ch4) { this._rc.ch4 = ch4; changed = true; }

    const thrUp   = K['ArrowUp']   || K['KeyE'] || K['Equal'];
    const thrDown = K['ArrowDown'] || K['KeyQ'] || K['Minus'];
    if (thrUp)   { this._rc.ch3 = this._clamp(this._rc.ch3 + 10, 1000, 2000); changed = true; }
    if (thrDown) { this._rc.ch3 = this._clamp(this._rc.ch3 - 10, 1000, 2000); changed = true; }

    if (changed && !this._connected) {
      this._onRC({ ...this._rc });
    }
  }
}

window.GamepadController = GamepadController;
