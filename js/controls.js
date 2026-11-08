/**
 * ============================================================================
 * MALVINAS 1982 — SISTEMA DE VUELO E INTERACTIVIDAD (TECLADO + TOUCH/DRAG)
 * ============================================================================
 * Responsabilidades (Requerimiento Técnico #3):
 *  - Soporte simultáneo de Teclado (Flechas / WASD) y Touch / Pointer Drag móvil.
 *  - Efecto de Alabeo / Giro (Roll) acotado con precisión entre -12° y +12°,
 *    enlazado al deslizamiento lateral en X del océano y parallax del horizonte.
 *  - Efecto de Aceleración / Postcombustión (Arriba / W / Botón Touch / Drag Up):
 *    incrementa el flujo de scanlines, velocidad 3D y tasa de generación de olas.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  const MAX_ROLL_DEG = 12.0; // Límite exacto requerido: -12° a +12°
  const DEG_TO_RAD = Math.PI / 180;

  class FlightControls {
    constructor(canvas, throttleBtn) {
      this.canvas = canvas;
      this.throttleBtn = throttleBtn;

      this.keys = {
        left: false,
        right: false,
        up: false,
        down: false,
      };

      // Estado del drag táctil / puntero
      this.pointer = {
        active: false,
        id: null,
        originX: 0,
        originY: 0,
        currX: 0,
        currY: 0,
        axisX: 0, // -1 .. +1
        axisY: 0, // -1 .. +1 (negativo = empujar hacia arriba / acelerar)
      };

      this.touchBoostHeld = false;

      // Estado cinemático de vuelo exportado a las capas
      this.state = {
        rollInput: 0, // -1 (Izquierda) .. +1 (Derecha)
        rollDeg: 0, // -12° .. +12° (inclinación activa del horizonte)
        rollRad: 0,
        throttle: 0, // 0 = crucero, 1 = máxima postcombustión, -0.5 = freno
        speedMultiplier: 1.0, // 0.62x .. 2.38x velocidad de scanlines
        knots: 430, // Velocidad indicada en HUD
        altitudeMeters: 12.0, // Vuelo rasante sobre el mar
        barrelRollTimer: 0, // Maniobra evasiva opcional [Espacio]
        barrelRollDir: 1,
      };

      this._bindKeyboard();
      this._bindPointer();
      this._bindTouchThrottle();
    }

    _bindKeyboard() {
      const handleKey = (e, isDown) => {
        switch (e.code) {
          case "ArrowLeft":
          case "KeyA":
            this.keys.left = isDown;
            e.preventDefault();
            break;
          case "ArrowRight":
          case "KeyD":
            this.keys.right = isDown;
            e.preventDefault();
            break;
          case "ArrowUp":
          case "KeyW":
            this.keys.up = isDown;
            e.preventDefault();
            break;
          case "ArrowDown":
          case "KeyS":
            this.keys.down = isDown;
            e.preventDefault();
            break;
          case "Space":
            if (isDown && this.state.barrelRollTimer <= 0) {
              this.state.barrelRollTimer = 0.62;
              this.state.barrelRollDir = this.state.rollInput < 0 ? -1 : 1;
            }
            e.preventDefault();
            break;
        }
      };

      global.addEventListener("keydown", (e) => handleKey(e, true), {
        passive: false,
      });
      global.addEventListener("keyup", (e) => handleKey(e, false), {
        passive: false,
      });
      global.addEventListener("blur", () => {
        this.keys.left = false;
        this.keys.right = false;
        this.keys.up = false;
        this.keys.down = false;
        this.pointer.active = false;
        this.touchBoostHeld = false;
      });
    }

    _bindPointer() {
      const el = this.canvas;
      if (!el) return;

      const toNormalizedDelta = (clientX, clientY) => {
        const rect = el.getBoundingClientRect();
        const maxDragX = Math.max(55, rect.width * 0.14);
        const maxDragY = Math.max(45, rect.height * 0.16);
        const dx = clientX - this.pointer.originX;
        const dy = clientY - this.pointer.originY;
        this.pointer.currX = ((clientX - rect.left) / rect.width) * el.width;
        this.pointer.currY = ((clientY - rect.top) / rect.height) * el.height;
        this.pointer.axisX = Math.max(-1, Math.min(1, dx / maxDragX));
        this.pointer.axisY = Math.max(-1, Math.min(1, dy / maxDragY));
      };

      el.addEventListener("pointerdown", (e) => {
        if (this.pointer.active) return;
        const rect = el.getBoundingClientRect();
        this.pointer.active = true;
        this.pointer.id = e.pointerId;
        this.pointer.originX = e.clientX;
        this.pointer.originY = e.clientY;
        this.pointer.currX = ((e.clientX - rect.left) / rect.width) * el.width;
        this.pointer.currY = ((e.clientY - rect.top) / rect.height) * el.height;
        this.pointer.axisX = 0;
        this.pointer.axisY = 0;
        if (el.setPointerCapture) {
          try {
            el.setPointerCapture(e.pointerId);
          } catch (_err) {
            /* ignore */
          }
        }
      });

      el.addEventListener("pointermove", (e) => {
        if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
        toNormalizedDelta(e.clientX, e.clientY);
      });

      const endPointer = (e) => {
        if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
        this.pointer.active = false;
        this.pointer.id = null;
        this.pointer.axisX = 0;
        this.pointer.axisY = 0;
      };

      el.addEventListener("pointerup", endPointer);
      el.addEventListener("pointercancel", endPointer);
    }

    _bindTouchThrottle() {
      const btn = this.throttleBtn;
      if (!btn) return;

      const setBoost = (active, e) => {
        if (e) e.preventDefault();
        this.touchBoostHeld = active;
        btn.classList.toggle("engaged", active);
      };

      btn.addEventListener("pointerdown", (e) => setBoost(true, e));
      btn.addEventListener("pointerup", (e) => setBoost(false, e));
      btn.addEventListener("pointercancel", (e) => setBoost(false, e));
      btn.addEventListener("pointerleave", (e) => setBoost(false, e));
    }

    update(dt, timeSec) {
      const s = this.state;

      // 1. Entrada combinada de Alabeo (Teclado + Touch/Drag)
      let kbRoll = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      let combinedRoll = kbRoll !== 0 ? kbRoll : this.pointer.axisX;
      combinedRoll = Math.max(-1, Math.min(1, combinedRoll));
      s.rollInput = combinedRoll;

      // Inercia aerodinámica suave hacia [-12°, +12°]
      const targetRollDeg = combinedRoll * MAX_ROLL_DEG;
      const rollResponsiveness = combinedRoll !== 0 ? 8.5 : 6.2;
      s.rollDeg += (targetRollDeg - s.rollDeg) * Math.min(1, rollResponsiveness * dt);
      if (Math.abs(s.rollDeg) < 0.02 && combinedRoll === 0) s.rollDeg = 0;
      s.rollRad = s.rollDeg * DEG_TO_RAD;

      // 2. Entrada de Aceleración / Postcombustión (Arriba / W / Drag hacia arriba / Botón)
      let targetThrottle = 0;
      if (this.keys.up || this.touchBoostHeld) {
        targetThrottle = 1.0;
      } else if (this.keys.down) {
        targetThrottle = -0.55;
      } else if (this.pointer.active && this.pointer.axisY < -0.2) {
        targetThrottle = Math.min(1.0, (-this.pointer.axisY - 0.2) / 0.8);
      } else if (this.pointer.active && this.pointer.axisY > 0.35) {
        targetThrottle = -0.45 * ((this.pointer.axisY - 0.35) / 0.65);
      }

      const throttleRate = targetThrottle > s.throttle ? 3.8 : 2.6;
      s.throttle += (targetThrottle - s.throttle) * Math.min(1, throttleRate * dt);

      // Multiplicador de flujo de scanlines y velocidad 3D sobre el océano
      if (s.throttle >= 0) {
        s.speedMultiplier = 1.0 + s.throttle * 1.42; // Hasta 2.42x en postcombustión
      } else {
        s.speedMultiplier = 1.0 + s.throttle * 0.65; // Mínimo ~0.64x en freno
      }

      s.knots = Math.round(430 + s.throttle * 195 + Math.sin(timeSec * 7.3) * 2);

      // Altímetro radar: desciende aún más al ras de las olas al acelerar a fondo
      const targetAlt =
        11.5 - Math.max(0, s.throttle) * 3.8 + Math.abs(s.rollDeg) * 0.14;
      s.altitudeMeters +=
        (targetAlt + Math.sin(timeSec * 4.1) * 0.35 - s.altitudeMeters) *
        Math.min(1, 5 * dt);

      if (s.barrelRollTimer > 0) {
        s.barrelRollTimer = Math.max(0, s.barrelRollTimer - dt);
      }

      return s;
    }
  }

  Malvinas.FlightControls = FlightControls;
  Malvinas.MAX_ROLL_DEG = MAX_ROLL_DEG;
})(window);

