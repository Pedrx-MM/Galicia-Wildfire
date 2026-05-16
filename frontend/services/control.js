'use strict';
/**
 * Galicia Wildfire — WebSocket de control (/ws/control)
 * Envía comandos al backend: arm, set_mode, rc_override, rtl, etc.
 * Reconecta automáticamente si la conexión se pierde.
 */

class ControlWebSocket {
  /**
   * @param {string} url   — ws://host:port/ws/control
   * @param {object} opts
   * @param {function} opts.onOpen    — callback cuando la WS abre
   * @param {function} opts.onClose   — callback cuando la WS cierra
   * @param {function} opts.onReply   — callback({ok, msg}) con respuesta del backend
   */
  constructor(url, { onOpen, onClose, onReply } = {}) {
    this._url      = url;
    this._ws       = null;
    this._ready    = false;
    this._queue    = [];           // mensajes pendientes mientras reconecta
    this._retryMs  = 1500;
    this._retryTimer = null;

    this._onOpen   = onOpen   ?? (() => {});
    this._onClose  = onClose  ?? (() => {});
    this._onReply  = onReply  ?? (() => {});
  }

  connect() {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return;
    this._ws = new WebSocket(this._url);

    this._ws.onopen = () => {
      this._ready = true;
      console.log('[ControlWS] Conectado');
      this._onOpen();
      // Vaciar cola de mensajes pendientes
      while (this._queue.length) this._ws.send(this._queue.shift());
    };

    this._ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        this._onReply(data);
      } catch { /* noop */ }
    };

    this._ws.onclose = () => {
      this._ready = false;
      console.warn('[ControlWS] Desconectado — reconectando en', this._retryMs, 'ms');
      this._onClose();
      clearTimeout(this._retryTimer);
      this._retryTimer = setTimeout(() => this.connect(), this._retryMs);
    };

    this._ws.onerror = (e) => {
      console.warn('[ControlWS] Error WS:', e);
    };
  }

  disconnect() {
    clearTimeout(this._retryTimer);
    if (this._ws) {
      this._ws.onclose = null;   // evitar reconexión automática
      this._ws.close();
      this._ws = null;
    }
    this._ready = false;
  }

  /**
   * Envía un comando JSON. Se encola si la WS no está lista aún.
   * @param {string} action
   * @param {object} params
   */
  send(action, params = {}) {
    const msg = JSON.stringify({ action, ...params });
    if (this._ready) {
      this._ws.send(msg);
    } else {
      this._queue.push(msg);
    }
  }

  // ─── Helpers de alto nivel ────────────────────────────────────────────────

  arm()         { this.send('arm'); }
  disarm()      { this.send('disarm'); }
  rtl()         { this.send('rtl'); }
  land()        { this.send('land'); }
  takeoff(alt = 30) { this.send('takeoff', { alt }); }
  startMission() { this.send('start_mission'); }
  setMode(mode) { this.send('set_mode', { mode }); }

  /**
   * Envía RC override con canales nominales ArduCopter.
   * @param {{ roll, pitch, throttle, yaw }} — valores en µs (1000–2000)
   */
  sendRCOverride({ roll = 1500, pitch = 1500, throttle = 1500, yaw = 1500 }) {
    this.send('rc_override', {
      channels: { roll, pitch, throttle, yaw },
    });
  }
}

window.ControlWebSocket = ControlWebSocket;
