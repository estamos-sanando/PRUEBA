/**
 * ============================================================================
 * MALVINAS 1982 — SISTEMA DE VUELO E INTERACTIVIDAD (TECLADO + TOUCH/DRAG)
 * ============================================================================
 * Responsabilidades (Ludonarrativa & Requerimientos):
 *  - Control de alabeo (Roll) enlazado al horizonte y deslizamiento lateral (-12° a +12°).
 *  - Control directo de ALTITUD (Alt):
 *      * Subir / Bajar con W / S, Flechas Arriba / Abajo o Drag táctil vertical.
 *      * Altitud óptima rasante: 6m a 12m.
 *      * Alerta Radar si Alt > 15m (RWR activo y detección creciente).
 *      * Riesgo de colisión si Alt < 4m (espuma y turbulencia).
 *  - Control de Acelerador / Postcombustión (Shift / Botón Turbo).
 *  - Gatillo de lanzamiento del Exocet AM-39 (Espacio / Tecla E / Botón Fuego).
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  const MAX_ROLL_DEG = 12.0;
  const DEG_TO_RAD = Math.PI / 180;

  class FlightControls {
    constructor(canvas, throttleBtn, fireBtn) {
      this.canvas = canvas;
      this.throttleBtn = throttleBtn;
      this.fireBtn = fireBtn;

      this.keys = {
        left: false,
        right: false,
        up: false,
        down: false,
        boost: false,
        brake: false,
        fire: false,
      };

      // Estado del drag táctil / puntero virtual
      this.pointer = {
        active: false,
        id: null,
        originX: 0,
        originY: 0,
        currX: 0,
        currY: 0,
        axisX: 0, // -1 (Izq) .. +1 (Der)
        axisY: 0, // -1 (Subir) .. +1 (Bajar)
      };

      this.touchBoostHeld = false;
      this.fireTriggered = false;

      // Estado cinemático exportado
      this.state = {
        rollInput: 0,
        rollDeg: 0,
        rollRad: 0,
        pitchDeg: 0, // Inclinación de cabeceo visual al subir/bajar
        throttle: 0,
        speedMultiplier: 1.0,
        knots: 430,
        altitudeMeters: 9.5, // Altitud rasante inicial histórica
        targetAltitude: 9.5,
        climbRate: 0,
        crashed: false,
        detected: false,
        detectionLevel: 0, // 0% .. 100%
        barrelRollTimer: 0,
        barrelRollDir: 1,
      };

      this._bindKeyboard();
      this._bindPointer();
      this._bindTouchButtons();
    }

    _bindKeyboard() {
      const handleKey = (e, isDown) => {
        // Ignorar atajos si el foco está en un input
        if (e.target && e.target.tagName === "INPUT") return;

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
            this.keys.up = isDown; // Subir / trepar altitud
            e.preventDefault();
            break;
          case "ArrowDown":
          case "KeyS":
            this.keys.down = isDown; // Bajar / rasante extremo
            e.preventDefault();
            break;
          case "ShiftLeft":
          case "ShiftRight":
            this.keys.boost = isDown;
            break;
          case "Space":
          case "KeyE":
          case "KeyF":
          case "Enter":
            if (isDown) {
              this.fireTriggered = true;
            }
            e.preventDefault();
            break;
        }
      };

      global.addEventListener("keydown", (e) => handleKey(e, true), { passive: false });
      global.addEventListener("keyup", (e) => handleKey(e, false), { passive: false });
      global.addEventListener("blur", () => {
        for (const k in this.keys) this.keys[k] = false;
        this.pointer.active = false;
        this.touchBoostHeld = false;
      });
    }

    _bindPointer() {
      const el = this.canvas;
      if (!el) return;

      const toNormalizedDelta = (clientX, clientY) => {
        const rect = el.getBoundingClientRect();
        const maxDragX = Math.max(50, rect.width * 0.15);
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
          } catch (_err) {}
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

    _bindTouchButtons() {
      if (this.throttleBtn) {
        const setBoost = (active, e) => {
          if (e) e.preventDefault();
          this.touchBoostHeld = active;
          this.throttleBtn.classList.toggle("engaged", active);
        };
        this.throttleBtn.addEventListener("pointerdown", (e) => setBoost(true, e));
        this.throttleBtn.addEventListener("pointerup", (e) => setBoost(false, e));
        this.throttleBtn.addEventListener("pointercancel", (e) => setBoost(false, e));
        this.throttleBtn.addEventListener("pointerleave", (e) => setBoost(false, e));
      }

      if (this.fireBtn) {
        this.fireBtn.addEventListener("pointerdown", (e) => {
          if (e) e.preventDefault();
          this.fireTriggered = true;
        });
      }
    }

    consumeFireTrigger() {
      const triggered = this.fireTriggered;
      this.fireTriggered = false;
      return triggered;
    }

    resetFlight(initialAlt = 9.5) {
      const s = this.state;
      s.altitudeMeters = initialAlt;
      s.targetAltitude = initialAlt;
      s.climbRate = 0;
      s.crashed = false;
      s.detected = false;
      s.detectionLevel = 0;
      s.rollDeg = 0;
      s.rollRad = 0;
      s.pitchDeg = 0;
      s.throttle = 0;
      s.speedMultiplier = 1.0;
    }

    update(dt, timeSec) {
      const s = this.state;

      // 1. Entrada de Alabeo (Izquierda / Derecha)
      let kbRoll = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      let combinedRoll = kbRoll !== 0 ? kbRoll : this.pointer.axisX;
      combinedRoll = Math.max(-1, Math.min(1, combinedRoll));
      s.rollInput = combinedRoll;

      const targetRollDeg = combinedRoll * MAX_ROLL_DEG;
      const rollResponsiveness = combinedRoll !== 0 ? 8.5 : 6.2;
      s.rollDeg += (targetRollDeg - s.rollDeg) * Math.min(1, rollResponsiveness * dt);
      if (Math.abs(s.rollDeg) < 0.02 && combinedRoll === 0) s.rollDeg = 0;
      s.rollRad = s.rollDeg * DEG_TO_RAD;

      // 2. Control de Altitud y Cabeceo (Pitch)
      // W / Arriba / Drag Up: trepar (+Altitud)
      // S / Abajo / Drag Down: picar (-Altitud hacia el agua)
      let verticalInput = 0;
      if (this.keys.up) verticalInput += 1.0;
      if (this.keys.down) verticalInput -= 1.0;
      if (this.pointer.active) {
        verticalInput -= this.pointer.axisY; // Drag hacia arriba trepa
      }
      verticalInput = Math.max(-1.0, Math.min(1.0, verticalInput));

      // Velocidad vertical de ascenso / descenso (m/s)
      const maxClimbSpeed = 12.0;
      s.climbRate = verticalInput * maxClimbSpeed;
      s.altitudeMeters += s.climbRate * dt;

      // Inclinación de cabeceo visual (grados)
      const targetPitch = verticalInput * 5.5;
      s.pitchDeg += (targetPitch - s.pitchDeg) * Math.min(1, 7 * dt);

      // 3. Acelerador y Potencia
      let targetThrottle = 0;
      if (this.keys.boost || this.touchBoostHeld) {
        targetThrottle = 1.0;
      }

      const throttleRate = targetThrottle > s.throttle ? 3.5 : 2.5;
      s.throttle += (targetThrottle - s.throttle) * Math.min(1, throttleRate * dt);
      s.speedMultiplier = 1.0 + s.throttle * 0.55;
      s.knots = Math.round(440 + s.throttle * 140 + Math.sin(timeSec * 6.5) * 2);

      // 4. Lógica de Sigilo Radar / Detección y Peligro de Impacto
      if (s.altitudeMeters > 15.0) {
        // En lóbulo radar del Sheffield Type 965: acumula detección
        const excess = s.altitudeMeters - 15.0;
        const rate = Math.min(35.0, 12.0 + excess * 2.5);
        s.detectionLevel = Math.min(100.0, s.detectionLevel + rate * dt);
      } else {
        // En rasante sigiloso: disipa detección gradualmente
        s.detectionLevel = Math.max(0.0, s.detectionLevel - 18.0 * dt);
      }

      // Comprobar condiciones de fallo
      if (s.detectionLevel >= 100.0) {
        s.detected = true;
      }
      if (s.altitudeMeters <= 0.6) {
        s.crashed = true;
        s.altitudeMeters = 0.5;
      }

      return s;
    }
  }

  Malvinas.FlightControls = FlightControls;
  Malvinas.MAX_ROLL_DEG = MAX_ROLL_DEG;
})(window);
