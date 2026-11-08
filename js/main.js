/**
 * ============================================================================
 * MALVINAS 1982 — BUCLE PRINCIPAL & ORQUESTADOR DEL NEWSGAMING HISTÓRICO
 * ============================================================================
 * Integra:
 *  - Máquina de estados narrativos (Briefing -> Vuelo Rasante -> Ataque -> Final).
 *  - Motor de Audio Chiptune 16 bits y turbina procedural.
 *  - Renderizado Super Scaler de 5 capas en Canvas 640x360 pixel-perfect.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  function bootstrap() {
    const Config = Malvinas.Config;
    const Layers = Malvinas.Layers;
    const news = Malvinas.newsgaming;
    const sound = Malvinas.sound;

    const screenCanvas = document.getElementById("game-canvas");
    screenCanvas.width = Config.VIEW_W;
    screenCanvas.height = Config.VIEW_H;
    const screenCtx = screenCanvas.getContext("2d", { alpha: false });
    screenCtx.imageSmoothingEnabled = false;

    // Buffer offscreen de mundo con overscan para rotación limpia de -12° a +12°
    const worldCanvas = document.createElement("canvas");
    worldCanvas.width = Config.WORLD_W;
    worldCanvas.height = Config.WORLD_H;
    const worldCtx = worldCanvas.getContext("2d", { alpha: false });
    worldCtx.imageSmoothingEnabled = false;

    const bootOverlay = document.getElementById("boot-overlay");
    const bootBar = document.getElementById("boot-bar-fill");
    const bootStatus = document.getElementById("boot-status");

    const briefingModal = document.getElementById("briefing-modal");
    const victoryModal = document.getElementById("victory-modal");
    const failedModal = document.getElementById("failed-modal");
    const failTitle = document.getElementById("fail-title");
    const failDesc = document.getElementById("fail-desc");

    const statAvgAlt = document.getElementById("stat-avg-alt");
    const statMaxDet = document.getElementById("stat-max-det");

    const btnStart = document.getElementById("btn-start-mission");
    const btnReplay = document.getElementById("btn-replay-mission");
    const btnRetry = document.getElementById("btn-retry-mission");
    const btnAudio = document.getElementById("btn-audio");

    const touchThrottleBtn = document.getElementById("touch-throttle-btn");
    const touchFireBtn = document.getElementById("touch-fire-btn");
    const crtOverlay = document.getElementById("crt-overlay");

    const camera = Malvinas.createCameraState();
    const controls = new Malvinas.FlightControls(
      screenCanvas,
      touchThrottleBtn,
      touchFireBtn
    );

    // ------------------------------------------------------------------------
    // GESTIÓN DE AUDIO Y BOTÓN MUTE
    // ------------------------------------------------------------------------
    if (btnAudio) {
      btnAudio.addEventListener("click", () => {
        const isMuted = sound.toggleMute();
        btnAudio.textContent = isMuted ? "🔇 AUDIO: OFF" : "🔊 AUDIO: ON";
        btnAudio.classList.toggle("active", !isMuted);
        screenCanvas.focus();
      });
    }

    // ------------------------------------------------------------------------
    // CONTROLADORES DE MODALES Y ETAPAS HISTÓRICAS
    // ------------------------------------------------------------------------
    function startMissionFromBriefing() {
      if (briefingModal) briefingModal.classList.add("hidden");
      if (failedModal) failedModal.classList.add("hidden");
      if (victoryModal) victoryModal.classList.add("hidden");

      controls.resetFlight(9.5);
      camera.x = 0;
      camera.z = 0;
      camera.heading = 0;

      news.startMission();
      screenCanvas.focus();
    }

    if (btnStart) btnStart.addEventListener("click", startMissionFromBriefing);
    if (btnReplay) btnReplay.addEventListener("click", startMissionFromBriefing);
    if (btnRetry) btnRetry.addEventListener("click", startMissionFromBriefing);

    // Atajo de teclado para iniciar o disparar en el briefing
    global.addEventListener("keydown", (e) => {
      if (
        (e.code === "Space" || e.code === "Enter") &&
        briefingModal &&
        !briefingModal.classList.contains("hidden")
      ) {
        startMissionFromBriefing();
        e.preventDefault();
      }
    });

    // ------------------------------------------------------------------------
    // CONMUTADORES INTERACTIVOS DE CAPAS MODULARES
    // ------------------------------------------------------------------------
    function syncToolbarButtons() {
      document.querySelectorAll("[data-toggle]").forEach((btn) => {
        const key = btn.getAttribute("data-toggle");
        let isOn = false;
        if (key === "bg") isOn = Layers.LAYER_BACKGROUND.enabled;
        else if (key === "ocean") isOn = Layers.LAYER_OCEAN.enabled;
        else if (key === "waves") isOn = Layers.LAYER_OCEAN.wavesEnabled;
        else if (key === "enemies") isOn = Layers.LAYER_ENEMIES.enabled;
        else if (key === "player") isOn = Layers.LAYER_PLAYER.enabled;
        else if (key === "hud") isOn = Layers.LAYER_HUD.enabled;
        else if (key === "crt") isOn = !crtOverlay.classList.contains("hidden");
        btn.classList.toggle("active", isOn);
      });
    }

    function toggleFeature(key) {
      if (key === "bg") Layers.LAYER_BACKGROUND.enabled = !Layers.LAYER_BACKGROUND.enabled;
      else if (key === "ocean") Layers.LAYER_OCEAN.enabled = !Layers.LAYER_OCEAN.enabled;
      else if (key === "waves") Layers.LAYER_OCEAN.wavesEnabled = !Layers.LAYER_OCEAN.wavesEnabled;
      else if (key === "enemies") Layers.LAYER_ENEMIES.enabled = !Layers.LAYER_ENEMIES.enabled;
      else if (key === "player") Layers.LAYER_PLAYER.enabled = !Layers.LAYER_PLAYER.enabled;
      else if (key === "hud") Layers.LAYER_HUD.enabled = !Layers.LAYER_HUD.enabled;
      else if (key === "crt") crtOverlay.classList.toggle("hidden");
      syncToolbarButtons();
    }

    document.querySelectorAll("[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggleFeature(btn.getAttribute("data-toggle"));
        screenCanvas.focus();
      });
    });

    const btnFire = document.getElementById("btn-fire");
    if (btnFire) {
      btnFire.addEventListener("click", () => {
        Layers.LAYER_ENEMIES.triggerAttack();
        screenCanvas.focus();
      });
    }

    global.addEventListener("keydown", (e) => {
      if (e.code === "Digit1") toggleFeature("bg");
      else if (e.code === "Digit2") toggleFeature("ocean");
      else if (e.code === "Digit3") toggleFeature("waves");
      else if (e.code === "Digit4") toggleFeature("enemies");
      else if (e.code === "Digit5") toggleFeature("player");
      else if (e.code === "Digit6") toggleFeature("hud");
      else if (e.code === "KeyC") toggleFeature("crt");
      else if (e.code === "KeyM") sound.toggleMute();
    });

    // ------------------------------------------------------------------------
    // CARGA DE ASSETS & LOOP PRINCIPAL A 60 FPS
    // ------------------------------------------------------------------------
    Malvinas.AssetProcessor.loadAllAssets((progress) => {
      if (bootBar) bootBar.style.width = Math.round(progress * 100) + "%";
    })
      .then((assets) => {
        Layers.LAYER_BACKGROUND.init(assets);
        Layers.LAYER_OCEAN.init(assets);
        Layers.LAYER_ENEMIES.init(assets);
        Layers.LAYER_PLAYER.init(assets);
        Layers.LAYER_HUD.init(assets);
        syncToolbarButtons();

        if (bootOverlay) bootOverlay.classList.add("ready");

        let lastTs = performance.now();
        let victoryShown = false;
        let failShown = false;

        function frameLoop(now) {
          const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) * 0.001));
          lastTs = now;
          const timeSec = now * 0.001;

          // 1. Manejo de gatillo de disparo
          if (controls.consumeFireTrigger()) {
            if (news.stage === Malvinas.STAGES.COORDINATED_ATTACK) {
              Layers.LAYER_ENEMIES.triggerAttack();
            }
          }

          // 2. Actualizar controles de vuelo (Alabeo, Altitud y Potencia)
          const inFlight =
            news.stage === Malvinas.STAGES.STEALTH_FLIGHT ||
            news.stage === Malvinas.STAGES.COORDINATED_ATTACK ||
            news.stage === Malvinas.STAGES.MISSILE_FLIGHT ||
            news.stage === Malvinas.STAGES.IMPACT_AND_FIRE;

          const flight = controls.update(dt, timeSec);

          // 3. Actualizar la máquina de estados lúdica e histórica
          news.update(dt, camera, flight, Layers.LAYER_ENEMIES);

          // 4. Modulación de sonido procedural (Turbina, Oleaje y Alertas)
          sound.updateFlightSound(flight, flight.altitudeMeters, inFlight);

          // 5. Gestionar presentación de modales según estado
          if (news.stage === Malvinas.STAGES.HISTORICAL_DEBRIEFING && !victoryShown) {
            victoryShown = true;
            if (statAvgAlt) statAvgAlt.textContent = news.stats.avgAltitude.toFixed(1) + " M";
            if (statMaxDet) {
              const safePercent = Math.max(0, 100 - news.stats.maxDetection).toFixed(0);
              statMaxDet.textContent = safePercent + "% OK";
            }
            if (victoryModal) victoryModal.classList.remove("hidden");
          } else if (news.stage !== Malvinas.STAGES.HISTORICAL_DEBRIEFING) {
            victoryShown = false;
          }

          if (news.stage === Malvinas.STAGES.MISSION_FAILED && !failShown) {
            failShown = true;
            if (failDesc) failDesc.textContent = news.stats.failReason;
            if (failedModal) failedModal.classList.remove("hidden");
          } else if (news.stage !== Malvinas.STAGES.MISSION_FAILED) {
            failShown = false;
          }

          // 6. Cinemática de cámara 3D sobre el océano
          camera.rollDeg = flight.rollDeg;
          camera.rollRad = flight.rollRad;
          camera.currentSpeed = camera.forwardSpeed * flight.speedMultiplier;
          camera.z += camera.currentSpeed * dt;

          // Deslizamiento lateral acoplado al alabeo
          const lateralVel = Math.sin(flight.rollRad) * camera.currentSpeed * 2.25;
          camera.x += lateralVel * dt;
          camera.heading += Math.sin(flight.rollRad) * 0.52 * dt;
          // Altura de cámara vinculada a la altitud real de vuelo
          camera.y = 44.0 + flight.altitudeMeters * 0.85;

          // 7. Actualizar capas de mundo
          Layers.LAYER_BACKGROUND.update(dt, camera, flight, timeSec);
          Layers.LAYER_OCEAN.update(dt, camera, flight, timeSec);
          Layers.LAYER_ENEMIES.update(dt, camera, flight, timeSec);
          Layers.LAYER_PLAYER.update(dt, camera, flight, timeSec);
          Layers.LAYER_HUD.update(dt);

          // 8. Renderizar capas de mundo (Z-Index 10, 20, 30) en buffer con overscan
          worldCtx.imageSmoothingEnabled = false;
          Layers.LAYER_BACKGROUND.render(worldCtx, camera);
          Layers.LAYER_OCEAN.render(worldCtx, camera);
          Layers.LAYER_ENEMIES.render(worldCtx, camera);

          // 9. Proyectar mundo rotado según ángulo de alabeo (-12° a +12°) al viewport
          screenCtx.imageSmoothingEnabled = false;
          screenCtx.save();
          screenCtx.translate(Config.VIEW_W * 0.5, Config.HORIZON_SCREEN_Y);
          screenCtx.rotate(-camera.rollRad);
          screenCtx.drawImage(
            worldCanvas,
            -Config.WORLD_CX,
            -Config.HORIZON_WORLD_Y
          );
          screenCtx.restore();

          // 10. Superponer formación Super Étendard (Z-Index 40) y HUD táctico (Z-Index 50)
          Layers.LAYER_PLAYER.render(screenCtx, camera, flight, timeSec);
          Layers.LAYER_HUD.render(
            screenCtx,
            camera,
            flight,
            Layers.LAYER_ENEMIES,
            controls.pointer
          );

          requestAnimationFrame(frameLoop);
        }

        requestAnimationFrame(frameLoop);
      })
      .catch((err) => {
        console.error("[Malvinas Newsgaming] Error iniciando:", err);
        if (bootStatus) {
          bootStatus.textContent = "ERROR CARGANDO ASSETS: " + err.message;
        }
      });

    Malvinas.Runtime = {
      camera,
      controls,
      layers: Layers,
      sound,
      newsgaming: news,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})(window);
