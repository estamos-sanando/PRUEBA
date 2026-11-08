/**
 * ============================================================================
 * MALVINAS 1982 — MOTOR DE AUDIO PROCEDURAL (WEB AUDIO API)
 * ============================================================================
 * Efectos de sonido realistas en tiempo real (cero dependencias externas):
 *  - Turbina SNECMA Atar 8K50 (ruido rosa resonante modulado por acelerador y altitud).
 *  - Oleaje y viento del Atlántico Sur (filtro pasabajos dinámico).
 *  - RWR Radar Warning (bips de alerta cuando se vuela alto sobre el lóbulo radar).
 *  - Estática de radio militar para comunicaciones de Bedacarratz y Mayora.
 *  - Desprendimiento e ignición del cohete Exocet AM-39 (propelente sólido).
 *  - Impacto cinético y fuego incontrolable en el destructor Sheffield.
 *  (Música eliminada por solicitud para máximo realismo e inmersión histórica).
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.isMuted = false;
      this.initialized = false;

      // Nodos continuos
      this.jetNode = null;
      this.jetGain = null;
      this.jetFilter = null;

      this.seaNode = null;
      this.seaGain = null;
      this.seaFilter = null;

      this.rwrOsc = null;
      this.rwrGain = null;
      this.rwrInterval = null;
      this.rwrActive = false;

      this.fireNode = null;
      this.fireGain = null;
    }

    init() {
      if (this.initialized) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.75, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this._initTurbine();
      this._initSeaWash();
      this._initFireSound();

      this.initialized = true;
    }

    resume() {
      if (!this.initialized) this.init();
      if (this.ctx && this.ctx.state === "suspended") {
        this.ctx.resume();
      }
    }

    toggleMute() {
      this.isMuted = !this.isMuted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(
          this.isMuted ? 0 : 0.75,
          this.ctx.currentTime,
          0.04
        );
      }
      return this.isMuted;
    }

    _createNoiseBuffer(seconds = 2) {
      const bufferSize = this.ctx.sampleRate * seconds;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        data[i] = (last + 0.05 * white) / 1.05;
        last = data[i];
      }
      return buffer;
    }

    _initTurbine() {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(3);
      noise.loop = true;

      this.jetFilter = this.ctx.createBiquadFilter();
      this.jetFilter.type = "bandpass";
      this.jetFilter.frequency.setValueAtTime(420, this.ctx.currentTime);
      this.jetFilter.Q.setValueAtTime(3.5, this.ctx.currentTime);

      this.jetGain = this.ctx.createGain();
      this.jetGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      noise.connect(this.jetFilter);
      this.jetFilter.connect(this.jetGain);
      this.jetGain.connect(this.masterGain);

      noise.start();
      this.jetNode = noise;
    }

    _initSeaWash() {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(4);
      noise.loop = true;

      this.seaFilter = this.ctx.createBiquadFilter();
      this.seaFilter.type = "lowpass";
      this.seaFilter.frequency.setValueAtTime(260, this.ctx.currentTime);

      this.seaGain = this.ctx.createGain();
      this.seaGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      noise.connect(this.seaFilter);
      this.seaFilter.connect(this.seaGain);
      this.seaGain.connect(this.masterGain);

      noise.start();
      this.seaNode = noise;
    }

    _initFireSound() {
      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(3);
      noise.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(180, this.ctx.currentTime);
      filter.Q.setValueAtTime(1.2, this.ctx.currentTime);

      this.fireGain = this.ctx.createGain();
      this.fireGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);

      noise.connect(filter);
      filter.connect(this.fireGain);
      this.fireGain.connect(this.masterGain);

      noise.start();
      this.fireNode = noise;
    }

    updateFlightSound(flight, altitude, inFlight = true) {
      if (!this.initialized || !this.ctx || this.isMuted) return;

      const now = this.ctx.currentTime;

      if (!inFlight) {
        if (this.jetGain) this.jetGain.gain.setTargetAtTime(0.0001, now, 0.1);
        if (this.seaGain) this.seaGain.gain.setTargetAtTime(0.0001, now, 0.1);
        this.stopRwrAlarm();
        return;
      }

      // Modulación de turbina
      if (this.jetGain && this.jetFilter) {
        const throttleNorm = Math.max(0, Math.min(1, (flight.throttle + 0.55) / 1.55));
        const targetVol = 0.22 + throttleNorm * 0.32;
        const targetFreq = 380 + throttleNorm * 540 + Math.abs(flight.rollDeg) * 12;

        this.jetGain.gain.setTargetAtTime(targetVol, now, 0.08);
        this.jetFilter.frequency.setTargetAtTime(targetFreq, now, 0.08);
      }

      // Modulación de oleaje rasante
      if (this.seaGain && this.seaFilter) {
        const seaVol = Math.max(0.04, Math.min(0.45, (22 - altitude) / 22 * 0.4));
        const seaFreq = Math.max(180, Math.min(480, 500 - altitude * 18));
        this.seaGain.gain.setTargetAtTime(seaVol, now, 0.1);
        this.seaFilter.frequency.setTargetAtTime(seaFreq, now, 0.1);
      }
    }

    startRwrAlarm() {
      if (this.rwrActive || !this.initialized || !this.ctx || this.isMuted) return;
      this.rwrActive = true;

      const beep = () => {
        if (!this.rwrActive || !this.ctx || this.isMuted) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1480, now);
        osc.frequency.setValueAtTime(1860, now + 0.04);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.095);
      };

      beep();
      this.rwrInterval = (global.setInterval || setInterval)(beep, 180);
    }

    stopRwrAlarm() {
      if (!this.rwrActive) return;
      this.rwrActive = false;
      if (this.rwrInterval) {
        (global.clearInterval || clearInterval)(this.rwrInterval);
        this.rwrInterval = null;
      }
    }

    setFireVolume(vol) {
      if (!this.initialized || !this.fireGain || !this.ctx) return;
      const target = this.isMuted ? 0 : Math.max(0.0001, Math.min(0.5, vol));
      this.fireGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
    }

    playRadioComm() {
      if (!this.initialized || !this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1760, now);
      osc.frequency.setValueAtTime(1320, now + 0.06);

      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.16);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(0.2);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.12, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      noise.connect(nGain);
      nGain.connect(this.masterGain);
      noise.start(now);
      noise.stop(now + 0.22);
    }

    playMissileRelease() {
      if (!this.initialized || !this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(60, now + 0.25);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.25);
    }

    playRocketIgnition() {
      if (!this.initialized || !this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;

      const sub = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      sub.type = "sawtooth";
      sub.frequency.setValueAtTime(140, now);
      sub.frequency.exponentialRampToValueAtTime(38, now + 0.7);

      subGain.gain.setValueAtTime(0.48, now);
      subGain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);

      sub.connect(subGain);
      subGain.connect(this.masterGain);
      sub.start(now);
      sub.stop(now + 0.8);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(1.8);
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(620, now);
      filter.frequency.exponentialRampToValueAtTime(1150, now + 1.2);
      filter.Q.setValueAtTime(2.2, now);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.55, now);
      nGain.gain.exponentialRampToValueAtTime(0.01, now + 1.8);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);

      noise.start(now);
      noise.stop(now + 1.8);
    }

    playShipImpact() {
      if (!this.initialized || !this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;

      const boom = this.ctx.createOscillator();
      const boomGain = this.ctx.createGain();
      boom.type = "square";
      boom.frequency.setValueAtTime(95, now);
      boom.frequency.exponentialRampToValueAtTime(24, now + 0.65);

      boomGain.gain.setValueAtTime(0.65, now);
      boomGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      boom.connect(boomGain);
      boomGain.connect(this.masterGain);
      boom.start(now);
      boom.stop(now + 0.7);

      const noise = this.ctx.createBufferSource();
      noise.buffer = this._createNoiseBuffer(2.2);
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(950, now);
      filter.frequency.exponentialRampToValueAtTime(320, now + 1.8);

      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.6, now);
      nGain.gain.exponentialRampToValueAtTime(0.01, now + 2.0);

      noise.connect(filter);
      filter.connect(nGain);
      nGain.connect(this.masterGain);

      noise.start(now);
      noise.stop(now + 2.0);

      this.setFireVolume(0.45);
    }

    playFailureSound() {
      if (!this.initialized || !this.ctx || this.isMuted) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(45, now + 0.9);

      gain.gain.setValueAtTime(0.5, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.95);
    }

    startMusic() {
      // Música desactivada a petición del usuario para ambientación realista
    }

    stopMusic() {}
  }

  Malvinas.SoundEngine = SoundEngine;
  Malvinas.sound = new SoundEngine();
})(window);
