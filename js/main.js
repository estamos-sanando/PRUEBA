/**
 * ============================================================================
 * MALVINAS 1982 — BUCLE PRINCIPAL SUPER SCALER & ORQUESTADOR DE CAPAS
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  function bootstrap() {
    const Config = Malvinas.Config;
    const Layers = Malvinas.Layers;

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
    const throttleBtn = document.getElementById("touch-throttle-btn");
    const crtOverlay = document.getElementById("crt-overlay");

    const camera = Malvinas.createCameraState();
    const controls = new Malvinas.FlightControls(screenCanvas, throttleBtn);

    // ------------------------------------------------------------------------
    // Conmutadores interactivos de capas modulares (Teclas 1..6 y C, o botones)
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
      if (key === "bg") {
        Layers.LAYER_BACKGROUND.enabled = !Layers.LAYER_BACKGROUND.enabled;
      } else if (key === "ocean") {
        Layers.LAYER_OCEAN.enabled = !Layers.LAYER_OCEAN.enabled;
      } else if (key === "waves") {
        Layers.LAYER_OCEAN.wavesEnabled = !Layers.LAYER_OCEAN.wavesEnabled;
      } else if (key === "enemies") {
        Layers.LAYER_ENEMIES.enabled = !Layers.LAYER_ENEMIES.enabled;
      } else if (key === "player") {
        Layers.LAYER_PLAYER.enabled = !Layers.LAYER_PLAYER.enabled;
      } else if (key === "hud") {
        Layers.LAYER_HUD.enabled = !Layers.LAYER_HUD.enabled;
      } else if (key === "crt") {
        crtOverlay.classList.toggle("hidden");
      }
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
      else if (e.code === "KeyE" || e.code === "KeyF") {
        Layers.LAYER_ENEMIES.triggerAttack();
      }
    });

    // ------------------------------------------------------------------------
    // Soporte Drag & Drop para probar en vivo hojas combinadas sobre fondo #FFFFFF
    // ------------------------------------------------------------------------
    global.addEventListener("dragover", (e) => e.preventDefault());
    global.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file || !file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const parsed = Malvinas.AssetProcessor.extractFromCombinedSpritesheet(img);
          if (parsed) {
            Layers.LAYER_OCEAN.hotSwapAssets(parsed.ocean, parsed.frames);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    // ------------------------------------------------------------------------
    // Carga y preprocesamiento alfa (#FFFFFF -> transparente) + inicio 60fps
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

        function frameLoop(now) {
          const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) * 0.001));
          lastTs = now;
          const timeSec = now * 0.001;

          // 1. Actualizar controles de vuelo (Roll -12°..+12° y Aceleración)
          const flight = controls.update(dt, timeSec);

          // 2. Actualizar cinemática de cámara 3D sobre el océano
          camera.rollDeg = flight.rollDeg;
          camera.rollRad = flight.rollRad;
          camera.currentSpeed = camera.forwardSpeed * flight.speedMultiplier;
          camera.z += camera.currentSpeed * dt;

          // Deslizamiento lateral X acoplado al alabeo y velocidad (Req #3)
          const lateralVel =
            Math.sin(flight.rollRad) * camera.currentSpeed * 2.25;
          camera.x += lateralVel * dt;
          camera.heading += Math.sin(flight.rollRad) * 0.52 * dt;
          camera.y = 52.0 - Math.max(0, flight.throttle) * 7.5;

          // 3. Actualizar capas desacopladas en orden lógico
          Layers.LAYER_BACKGROUND.update(dt, camera, flight, timeSec);
          Layers.LAYER_OCEAN.update(dt, camera, flight, timeSec);
          Layers.LAYER_ENEMIES.update(dt, camera, flight, timeSec);
          Layers.LAYER_PLAYER.update(dt, camera, flight, timeSec);
          Layers.LAYER_HUD.update(dt, camera, flight, timeSec);

          // 4. Renderizar capas de mundo (Z-Index 10, 20, 30) en el buffer con overscan
          worldCtx.imageSmoothingEnabled = false;
          Layers.LAYER_BACKGROUND.render(worldCtx, camera);
          Layers.LAYER_OCEAN.render(worldCtx, camera);
          Layers.LAYER_ENEMIES.render(worldCtx, camera);

          // 5. Proyectar mundo rotado por el ángulo de alabeo (-12° a +12°) al viewport
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

          // 6. Superponer avión del jugador (Z-Index 40) y HUD táctico (Z-Index 50)
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
        console.error("[Malvinas Engine] Error iniciando assets:", err);
        if (bootStatus) {
          bootStatus.textContent = "ERROR CARGANDO ASSETS: " + err.message;
        }
      });

    // Exportar API pública para inspección/extensión desde consola
    Malvinas.Runtime = {
      camera,
      controls,
      layers: Layers,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})(window);

