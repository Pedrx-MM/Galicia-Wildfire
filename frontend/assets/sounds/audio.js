'use strict';
/**
 * Galicia Wildfire — Motor de audio sintetizado (Web Audio API).
 * Sin archivos externos — todos los sonidos se generan con osciladores/ruido.
 * Requiere llamar a unlock() en el primer gesto del usuario (política del navegador).
 */

class SoundEngine {
  constructor() {
    this._ctx         = null;
    this._crackleNode = null;
  }

  // ── Inicialización (llamar en primer gesto de usuario) ──────────────────────
  unlock() {
    if (this._ctx) {
      if (this._ctx.state === 'suspended') this._ctx.resume();
      return;
    }
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch { /* sin soporte Web Audio */ }
  }

  _ctx_ok() {
    if (!this._ctx) return null;
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  // ── Primitiva: tono oscilador ───────────────────────────────────────────────
  _tone(freq, offset, dur, type = 'sine', vol = 0.12) {
    const ctx = this._ctx_ok();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + offset;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  // ── Confirmación de ARM (dos pitidos ascendentes) ───────────────────────────
  arm() {
    this._tone(440, 0.00, 0.09, 'square', 0.10);
    this._tone(880, 0.10, 0.14, 'square', 0.10);
  }

  // ── Confirmación de DISARM (dos pitidos descendentes) ──────────────────────
  disarm() {
    this._tone(880, 0.00, 0.09, 'square', 0.09);
    this._tone(440, 0.10, 0.14, 'square', 0.08);
  }

  // ── Geofence cerrada (acorde C-E-G) ────────────────────────────────────────
  geofenceClose() {
    [523.25, 659.25, 783.99].forEach((f, i) => this._tone(f, i * 0.09, 0.26, 'sine', 0.11));
  }

  // ── Lanzamiento del enjambre (whoosh + zumbido de motores) ─────────────────
  swarmLaunch() {
    const ctx = this._ctx_ok();
    if (!ctx) return;
    const now = ctx.currentTime;
    // Whoosh ascendente
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(80, now);
    osc.frequency.linearRampToValueAtTime(380, now + 0.55);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.20);
    gain.gain.linearRampToValueAtTime(0, now + 0.60);
    osc.start(now);
    osc.stop(now + 0.65);
    // Motores de cisterna (tonos graves escalonados)
    [120, 140, 136, 128].forEach((f, i) => this._tone(f, 0.48 + i * 0.07, 0.4, 'square', 0.05));
  }

  // ── Alerta de viento fuerte (tres pitidos) ──────────────────────────────────
  alert() {
    [0, 0.22, 0.44].forEach(t => this._tone(880, t, 0.16, 'square', 0.13));
  }

  // ── Fanfarria de debrief (escala según puntuación) ──────────────────────────
  debriefFanfare(score) {
    if (score >= 75) {
      // Victoria — acorde ascendente + resolución final
      [523, 659, 784, 1047].forEach((f, i) => this._tone(f, i * 0.11, 0.28, 'sine', 0.12));
      [523, 659, 784].forEach(f => this._tone(f, 0.52, 0.70, 'sine', 0.09));
    } else if (score >= 45) {
      // Aceptable — acorde mayor resuelto
      [392, 494, 587].forEach((f, i) => this._tone(f, i * 0.07, 0.48, 'sine', 0.10));
    } else {
      // Bajo — menor descendente
      [440, 392, 349].forEach((f, i) => this._tone(f, i * 0.13, 0.38, 'sine', 0.09));
    }
  }

  // ── Crujido de incendio (ruido filtrado en bucle) ───────────────────────────
  startFireCrackle() {
    const ctx = this._ctx_ok();
    if (!ctx || this._crackleNode) return;

    const sr  = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sr * 2, sr);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 700;
    bpf.Q.value = 0.4;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 1400;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.038, ctx.currentTime + 2.5);

    src.connect(bpf);
    bpf.connect(lpf);
    lpf.connect(gain);
    gain.connect(ctx.destination);
    src.start();

    this._crackleNode = { src, gain };
  }

  stopFireCrackle() {
    if (!this._crackleNode || !this._ctx) return;
    const { src, gain } = this._crackleNode;
    gain.gain.linearRampToValueAtTime(0, this._ctx.currentTime + 1.5);
    const s = src;
    setTimeout(() => { try { s.stop(); } catch {} }, 1800);
    this._crackleNode = null;
  }
}

window.GW_AUDIO = new SoundEngine();
