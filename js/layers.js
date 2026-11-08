/**
 * ============================================================================
 * MALVINAS 1982 — CAPAS DESACOPLADAS & RENDERIZADOR SUPER SCALER 16-BIT
 * ============================================================================
 * Capas desacopladas por Z-Index (Requerimientos Técnicos #2 y #4):
 *
 *   [10] LAYER_BACKGROUND : Cielo crepuscular con islas Malvinas y nubes parallax.
 *   [20] LAYER_OCEAN      : Motor pseudo-3D de scanlines UV 1024x256 con doble
 *                           octava de detalle + olas 3D con escorzo rasante real.
 *   [30] LAYER_ENEMIES    : Destructor Tipo 42 HMS Sheffield (D80) con LOD según Z,
 *                           estela de proa animada, misiles Exocet AM-39 y secuencia
 *                           gradual de impacto, incendio incontrolable y agonía.
 *   [40] LAYER_PLAYER     : Formación de combate: Numeral (Mayora - jugador) en
 *                           primer plano y Líder (Bedacarratz) volando adelante.
 *   [50] LAYER_HUD        : Aviónica histórica: Altitud rasante, medidor de detección
 *                           radar Type 965, comunicaciones de radio y colimador.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  const LAYER_Z_INDEX = Object.freeze({
    LAYER_BACKGROUND: 10,
    LAYER_OCEAN: 20,
    LAYER_ENEMIES: 30,
    LAYER_PLAYER: 40,
    LAYER_HUD: 50,
  });

  const VIEW_W = 640;
  const VIEW_H = 360;

  const OVERSCAN_X = 120;
  const OVERSCAN_Y = 120;
  const WORLD_W = VIEW_W + OVERSCAN_X * 2; // 880 px
  const WORLD_H = VIEW_H + OVERSCAN_Y * 2; // 600 px
  const WORLD_CX = WORLD_W >> 1; // 440 px
  const HORIZON_SCREEN_Y = 148;
  const HORIZON_WORLD_Y = HORIZON_SCREEN_Y + OVERSCAN_Y; // 268 px
  const OCEAN_SCANLINES = WORLD_H - HORIZON_WORLD_Y; // 332 scanlines

  const CAMERA_BASE_HEIGHT = 52.0;
  const FOCAL_LENGTH = 252.0;
  const Z_HORIZON_FAR = 2650.0;
  const Z_CLIP_NEAR = 30.0;

  function createCameraState() {
    return {
      x: 0.0,
      y: CAMERA_BASE_HEIGHT,
      z: 0.0,
      heading: 0.0,
      forwardSpeed: 690.0,
      currentSpeed: 690.0,
      pitchOffsetPx: 0.0,
      rollRad: 0.0,
      rollDeg: 0.0,
    };
  }

  function projectWorldPoint(worldX, worldY, relZ, camera) {
    if (relZ <= Z_CLIP_NEAR || relZ > Z_HORIZON_FAR) return null;

    const scale = FOCAL_LENGTH / relZ;
    const effCamY = camera ? camera.y : CAMERA_BASE_HEIGHT;
    const effCamX = camera ? camera.x : 0.0;

    const screenX = WORLD_CX + (worldX - effCamX) * scale;
    const screenY = HORIZON_WORLD_Y + (effCamY - worldY) * scale;

    return {
      screenX,
      screenY,
      scale,
      depth: relZ,
    };
  }

  // ==========================================================================
  // [10] LAYER_BACKGROUND — CIELO CREPUSCULAR + ISLAS MALVINAS + NUBES PARALLAX
  // ==========================================================================
  const LAYER_BACKGROUND = {
    name: "LAYER_BACKGROUND",
    zIndex: LAYER_Z_INDEX.LAYER_BACKGROUND,
    enabled: true,

    skyCanvas: null,
    skySeamlessCanvas: null,
    skyTilePeriod: 0,
    skyDrawHeight: HORIZON_WORLD_Y + 70,

    cloudSprites: [],
    cloudEntities: [],

    init(assets) {
      if (assets.skyCanvas) {
        const src = assets.skyCanvas;
        // Panorama amplio de 1920px: el degradado y las nubes lejanas se renderizan a escala
        // lejana y atmosférica, revelando el amplio cielo crepuscular de Malvinas
        const tileW = 1920;
        this.skyTilePeriod = tileW * 2;
        this.skyDrawHeight = HORIZON_WORLD_Y + 70;

        const c = document.createElement("canvas");
        c.width = this.skyTilePeriod;
        c.height = this.skyDrawHeight;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;

        // Mitad A: panorama extendido con el degradado del cielo y nubes lejanas
        ctx.drawImage(src, 0, 0, tileW + 1, this.skyDrawHeight);

        // Mitad B: espejada para crear un bucle panorámico 360° continuo sin costuras
        ctx.save();
        ctx.translate(this.skyTilePeriod, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, tileW + 1, this.skyDrawHeight);
        ctx.restore();

        this.skySeamlessCanvas = c;
      }

      this.cloudEntities = [];
      const cloudSprites = Array.isArray(assets.clouds)
        ? assets.clouds
        : (assets.clouds && assets.clouds.elements) || [];
      this.cloudSprites = cloudSprites;

      if (cloudSprites.length > 0) {
        // Distribuir los 10 assets de nubes en la franja visible del cielo (Y visible en pantalla: 6 a 135 px)
        // En worldCanvas (con overscan Y=120): Y_world = Y_screen + 120 (rango 126 a 255 px)
        const count = 18;
        for (let i = 0; i < count; i++) {
          const plane = (i % 3) + 1;
          const spr = cloudSprites[i % cloudSprites.length];
          let scale, worldY, driftSpeed, alpha, parallaxRatio;

          if (plane === 1) {
            // Estrato 1: Nubes altas (Screen Y: 8 a 45) -> worldY: 128 a 165
            scale = 0.36 + Math.random() * 0.08;
            worldY = 128 + Math.random() * 37;
            driftSpeed = (0.3 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1);
            alpha = 0.85 + Math.random() * 0.10;
            parallaxRatio = 0.06;
          } else if (plane === 2) {
            // Estrato 2: Cúmulos medios (Screen Y: 35 a 85) -> worldY: 155 a 205
            scale = 0.46 + Math.random() * 0.10;
            worldY = 155 + Math.random() * 50;
            driftSpeed = (0.5 + Math.random() * 0.4) * (Math.random() > 0.5 ? 1 : -1);
            alpha = 0.90 + Math.random() * 0.08;
            parallaxRatio = 0.12;
          } else {
            // Estrato 3: Nubes bajas costeras sobre el horizonte (Screen Y: 70 a 125) -> worldY: 190 a 245
            scale = 0.56 + Math.random() * 0.12;
            worldY = 190 + Math.random() * 55;
            driftSpeed = (0.7 + Math.random() * 0.4) * (Math.random() > 0.5 ? 1 : -1);
            alpha = 0.94 + Math.random() * 0.06;
            parallaxRatio = 0.20;
          }

          // Distribuir uniformemente a lo largo del panorama X
          const spanX = WORLD_W * 2.2;
          const worldX = (i / count) * spanX - (spanX >> 1) + (Math.random() * 60 - 30);

          this.cloudEntities.push({
            sprite: spr,
            plane,
            parallaxRatio,
            scale,
            worldX,
            worldY,
            driftSpeed,
            alpha,
          });
        }
      }
    },

    update(dt, camera, flight, timeSec) {
      if (!this.enabled) return;
      const maxBound = WORLD_W * 1.5;
      for (let i = 0; i < this.cloudEntities.length; i++) {
        const c = this.cloudEntities[i];
        c.worldX += c.driftSpeed * dt * 10;
        if (c.worldX > maxBound) c.worldX -= maxBound * 2;
        if (c.worldX < -maxBound) c.worldX += maxBound * 2;
      }
    },

    render(ctx, camera) {
      if (!this.enabled) return;

      // Base continua de cielo crepuscular de Malvinas (garantiza cero huecos negros en alabeos extremos)
      const grad = ctx.createLinearGradient(0, 0, 0, HORIZON_WORLD_Y + 4);
      grad.addColorStop(0, "#2c163b");    // Violeta índigo profundo de la atmósfera alta
      grad.addColorStop(0.35, "#703554"); // Rosa vinoso crepuscular
      grad.addColorStop(0.65, "#d95f43"); // Coral atardecer
      grad.addColorStop(0.85, "#f79646"); // Ámbar dorado
      grad.addColorStop(1.0, "#f8c56c");  // Bruma cálida del horizonte
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, WORLD_W, HORIZON_WORLD_Y + 4);

      if (this.skySeamlessCanvas) {
        const period = this.skyTilePeriod;
        const parallaxX = (camera.heading * 260 + camera.x * 0.04) % period;
        let baseDrawX = -parallaxX;
        while (baseDrawX > 0) baseDrawX -= period;
        while (baseDrawX + period < WORLD_W) {
          ctx.drawImage(this.skySeamlessCanvas, baseDrawX, 0);
          baseDrawX += period;
        }
        ctx.drawImage(this.skySeamlessCanvas, baseDrawX, 0);
      }

      for (let i = 0; i < this.cloudEntities.length; i++) {
        const c = this.cloudEntities[i];
        if (!c.sprite) continue;
        const wrapSpan = WORLD_W * 2.2;
        let drawX = WORLD_CX + (c.worldX - camera.heading * 280 * c.parallaxRatio);
        while (drawX < -250) drawX += wrapSpan;
        while (drawX > WORLD_W + 250) drawX -= wrapSpan;

        const w = Math.round(c.sprite.width * c.scale);
        const h = Math.round(c.sprite.height * c.scale);
        ctx.save();
        ctx.globalAlpha = c.alpha || 0.92;
        ctx.drawImage(c.sprite, drawX - (w >> 1), c.worldY - (h >> 1), w, h);
        ctx.restore();
      }
    },
  };

  // ==========================================================================
  // [20] LAYER_OCEAN — MOTOR PSEUDO-3D DE SCANLINES UV + OLAS RASANTES DINÁMICAS
  // ==========================================================================
  const LAYER_OCEAN = {
    name: "LAYER_OCEAN",
    zIndex: LAYER_Z_INDEX.LAYER_OCEAN,
    enabled: true,
    wavesEnabled: true,

    oceanData: null,
    waveAssets: null,

    scanlineCanvas: null,
    scanlineCtx: null,
    scanlineImgData: null,
    scanlineBuf32: null,

    waveEntities: [],
    timeSec: 0,

    init(assets) {
      this.oceanData = assets.ocean || assets.oceanSurfaceData || null;
      this.waveAssets = assets.waves || assets.waveSequences || null;

      this.scanlineCanvas = document.createElement("canvas");
      this.scanlineCanvas.width = WORLD_W;
      this.scanlineCanvas.height = OCEAN_SCANLINES;
      this.scanlineCtx = this.scanlineCanvas.getContext("2d");
      this.scanlineCtx.imageSmoothingEnabled = false;
      this.scanlineImgData = this.scanlineCtx.createImageData(
        WORLD_W,
        OCEAN_SCANLINES
      );
      this.scanlineBuf32 = new Uint32Array(this.scanlineImgData.data.buffer);

      this._buildWaveField();
    },

    _buildWaveField() {
      this.waveEntities = [];
      const bands = [
        {
          name: "far",
          count: 28,
          zMin: 1050,
          zMax: 2400,
          swellWMin: 95, swellWMax: 155,
          breakerWMin: 70, breakerWMax: 110,
          splashWMin: 55, splashWMax: 90,
        },
        {
          name: "upperMid",
          count: 26,
          zMin: 480,
          zMax: 1050,
          swellWMin: 75, swellWMax: 125,
          breakerWMin: 55, breakerWMax: 90,
          splashWMin: 45, splashWMax: 75,
        },
        {
          name: "mid",
          count: 24,
          zMin: 175,
          zMax: 480,
          swellWMin: 58, swellWMax: 95,
          breakerWMin: 45, breakerWMax: 75,
          splashWMin: 36, splashWMax: 60,
        },
        {
          name: "near",
          count: 18,
          zMin: 45,
          zMax: 175,
          swellWMin: 50, swellWMax: 80,
          breakerWMin: 40, breakerWMax: 65,
          splashWMin: 32, splashWMax: 52,
        },
      ];

      const waveTypeKeys = [
        "swellLoop",
        "gentleSwell",
        "breakerRight",
        "breakerLeft",
        "splashRight",
        "splashLeft",
        "crestToSplashRight",
        "crestToSplashLeft",
      ];

      for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        for (let i = 0; i < band.count; i++) {
          const zRel = band.zMin + Math.random() * (band.zMax - band.zMin);
          const frustumHalfW = (zRel / FOCAL_LENGTH) * (WORLD_W * 0.55);
          const x = (Math.random() * 2 - 1) * frustumHalfW;

          // Seleccionar equitativamente entre los tipos para máxima variedad de los 15 sprites
          const type = waveTypeKeys[(b * 3 + i) % waveTypeKeys.length];
          let worldWidth;

          if (type.includes("swell") || type.includes("Swell")) {
            worldWidth = band.swellWMin + Math.random() * (band.swellWMax - band.swellWMin);
          } else if (type.includes("breaker")) {
            worldWidth = band.breakerWMin + Math.random() * (band.breakerWMax - band.breakerWMin);
          } else {
            worldWidth = band.splashWMin + Math.random() * (band.splashWMax - band.splashWMin);
          }

          this.waveEntities.push({
            type,
            x,
            y: 0,
            z: zRel,
            zMin: band.zMin,
            zMax: band.zMax,
            worldWidth,
            animSpeed: 6.0 + Math.random() * 3.0,
            frameIndex: Math.random() * 8,
          });
        }
      }
    },

    update(dt, camera, flight, timeSec) {
      if (!this.enabled) return;
      this.timeSec = timeSec;

      const oceanSpeed = camera.currentSpeed;
      for (let i = 0; i < this.waveEntities.length; i++) {
        const w = this.waveEntities[i];
        w.z -= oceanSpeed * dt;
        w.frameIndex += dt * w.animSpeed;

        if (w.z <= Z_CLIP_NEAR) {
          w.z += w.zMax - w.zMin;
          const frustumHalfW = (w.z / FOCAL_LENGTH) * (WORLD_W * 0.55);
          w.x = camera.x + (Math.random() * 2 - 1) * frustumHalfW;
          w.frameIndex = 0;
        }
      }
    },

    _renderScanlineSurface(worldCtx, camera) {
      const oData = this.oceanData;
      if (!oData || !oData.tex32 || !this.scanlineBuf32) {
        const grad = worldCtx.createLinearGradient(0, HORIZON_WORLD_Y, 0, WORLD_H);
        grad.addColorStop(0, "#083e74");
        grad.addColorStop(0.35, "#0b589f");
        grad.addColorStop(1, "#1988d8");
        worldCtx.fillStyle = grad;
        worldCtx.fillRect(0, HORIZON_WORLD_Y, WORLD_W, OCEAN_SCANLINES);
        return;
      }

      const out32 = this.scanlineBuf32;
      const tex32 = oData.tex32;
      const maskU = oData.texMaskU || 1023;
      const maskV = oData.texMaskV || 255;
      const shiftV = oData.texShiftV || 10;
      const horizonLUT = oData.horizonLUT;
      const lutMax = (oData.horizonLUTSize || 64) - 1;

      const projK = FOCAL_LENGTH * camera.y;
      const dyBias = (projK / Z_HORIZON_FAR) | 0;

      const U_SCALE = 0.52;
      const V_SCALE = 0.44;

      const camX = camera.x;
      const camZ = camera.z;
      const tSec = this.timeSec || 0;

      let outIdx = 0;

      for (let dy = 0; dy < OCEAN_SCANLINES; dy++) {
        const z = projK / (dy + dyBias);
        const invScale = z / FOCAL_LENGTH;

        const vCoord = ((camZ + z) * V_SCALE) | 0;
        const vRowOffset = (vCoord & maskV) << shiftV;

        // Ondulación horizontal del agua por scanline estilo Super Scaler (movimiento fluido y vivo)
        const swellDisplacement =
          Math.sin(z * 0.038 - tSec * 3.4) * Math.min(18.0, 260.0 / (dy + 12)) +
          Math.cos(z * 0.082 + tSec * 4.6) * 2.2;
        const worldLeftX = camX + swellDisplacement - WORLD_CX * invScale;

        let uFixed = (worldLeftX * U_SCALE * 65536.0) | 0;
        const stepUFixed = (invScale * U_SCALE * 65536.0) | 0;

        if (dy < 44 && horizonLUT) {
          const lutIdx = Math.min(lutMax, ((dy / 43) * lutMax) | 0);
          const hr = horizonLUT[lutIdx * 3];
          const hg = horizonLUT[lutIdx * 3 + 1];
          const hb = horizonLUT[lutIdx * 3 + 2];
          const fogWeight = (((44 - dy) * 215) / 44) | 0;
          const texWeight = 256 - fogWeight;

          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;

            const c = tex32[vRowOffset + tu];
            const tr = c & 0xff;
            const tg = (c >> 8) & 0xff;
            const tb = (c >> 16) & 0xff;

            const r = (tr * texWeight + hr * fogWeight) >> 8;
            const g = (tg * texWeight + hg * fogWeight) >> 8;
            const b = (tb * texWeight + hb * fogWeight) >> 8;

            out32[outIdx++] = 0xff000000 | (b << 16) | (g << 8) | r;
          }
        } else {
          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;
            out32[outIdx++] = tex32[vRowOffset + tu];
          }
        }
      }

      this.scanlineCtx.putImageData(this.scanlineImgData, 0, 0);
      worldCtx.drawImage(this.scanlineCanvas, 0, HORIZON_WORLD_Y);

      // Resplandor crepuscular dorado en la línea exacta del horizonte
      worldCtx.fillStyle = "rgba(255, 215, 140, 0.40)";
      worldCtx.fillRect(0, HORIZON_WORLD_Y, WORLD_W, 1);
    },

    _renderDynamicWaves(worldCtx, camera) {
      if (!this.wavesEnabled || !this.waveAssets) return;

      // Ordenar por Z descendente (painter's algorithm: atrás hacia adelante)
      this.waveEntities.sort((a, b) => b.z - a.z);

      for (let i = 0; i < this.waveEntities.length; i++) {
        const w = this.waveEntities[i];
        const proj = projectWorldPoint(w.x, w.y, w.z, camera);
        if (!proj) continue;

        const seq =
          this.waveAssets[w.type] ||
          this.waveAssets.swellLoop ||
          this.waveAssets.breakerRight;
        if (!seq || seq.length === 0) continue;

        const fIdx = (w.frameIndex | 0) % seq.length;
        const sprite = seq[fIdx];
        if (!sprite) continue;

        // Ancho en pantalla proporcional a la escala 3D
        const drawW = Math.max(8, Math.round(w.worldWidth * proj.scale));

        // Altura con escorzo rasante proporcionado para visualización After Burner II
        // Permite apreciar con nitidez los 15 sprites de olas, crestas blancas, rompientes y salpicaduras
        const aspect = sprite.height / sprite.width;
        const grazingFactor = 0.46 + 0.08 * Math.min(1.0, w.z / 900.0);
        const naturalH = Math.round(drawW * aspect * grazingFactor);
        const minH = w.z > 1200 ? 3 : w.z > 600 ? 5 : w.z > 250 ? 8 : 12;
        const maxLimit = w.z > 1200 ? 9 : w.z > 600 ? 17 : w.z > 250 ? 28 : 44;
        const drawH = Math.max(minH, Math.min(maxLimit, naturalH));

        // Base de la ola asentada en la línea de agua en pantalla
        const drawX = Math.round(proj.screenX - drawW * 0.5);
        const drawY = Math.round(proj.screenY - drawH * 0.82);

        // Renderizado íntegro del sprite con su espuma blanca y cuerpo
        // Permitir que la cresta de olas en el horizonte asome sutilmente (hasta 4px) para texturar la línea del mar
        if (drawY + drawH > HORIZON_WORLD_Y - 4 && drawY < WORLD_H && drawX + drawW > -60 && drawX < WORLD_W + 60) {
          worldCtx.drawImage(
            sprite,
            0, 0,
            sprite.width, sprite.height,
            drawX, drawY, drawW, drawH
          );
        }
      }
    },

    render(worldCtx, camera) {
      if (!this.enabled) return;
      this._renderScanlineSurface(worldCtx, camera);
      this._renderDynamicWaves(worldCtx, camera);
    },
  };

  // ==========================================================================
  // [30] LAYER_ENEMIES — DESTRUCTOR HMS SHEFFIELD (D80) + MISILES EXOCET
  // ==========================================================================
  const LAYER_ENEMIES = {
    name: "LAYER_ENEMIES",
    zIndex: LAYER_Z_INDEX.LAYER_ENEMIES,
    enabled: true,

    enemyAssets: null,
    ships: [],

    init(assets) {
      this.enemyAssets = assets.enemies || null;

      // HMS Sheffield (D80) ubicado inicialmente en el horizonte lejano
      // Escala ampliada a 340 unidades para que luzca con presencia imponente de destructor Tipo 42
      this.ships = [
        {
          id: "D-80",
          designation: "HMS SHEFFIELD (D80)",
          type: "D80",
          x: -80,
          y: 0,
          z: 2200, // En el horizonte, dentro del frustum
          vx: 8,
          vz: -20,
          worldWidth: 340,
          wakeAnim: 0,
          hp: 100,
          damageState: 0,
          explosionFrame: 0,
        },
      ];
    },

    triggerAttack() {
      if (Malvinas.newsgaming) {
        return Malvinas.newsgaming.triggerPlayerLaunch(
          Malvinas.Runtime && Malvinas.Runtime.controls
            ? Malvinas.Runtime.controls.state
            : { altitudeMeters: 9.5 },
          this
        );
      }
      return false;
    },

    update(dt, camera, flight, timeSec) {
      if (!this.enabled) return;
      for (let i = 0; i < this.ships.length; i++) {
        const ship = this.ships[i];
        ship.wakeAnim = (ship.wakeAnim + 7 * dt) % 5;
      }
    },

    render(ctx, camera) {
      if (!this.enabled) return;

      const ea = this.enemyAssets;

      // 1. Renderizar el HMS Sheffield
      for (let i = 0; i < this.ships.length; i++) {
        const ship = this.ships[i];
        const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
        if (!proj) continue;

        let sprite = null;

        if (ship.damageState > 0 && ea && ea.explosionSequence && ea.explosionSequence.length > 0) {
          const seq = ea.explosionSequence;
          const fIdx = Math.min(seq.length - 1, ship.explosionFrame | 0);
          sprite = seq[fIdx];
        } else if (ea && ea.ships) {
          // Visualización de alta definición del HMS Sheffield en todo el rango
          // (se descarta barcolejos por ser un sprite de baja resolución)
          if (ship.z > 1200) {
            sprite = ea.ships.barco1 || ea.ships.barco || ea.ships.barco4;
          } else if (ship.z > 700) {
            sprite = (ship.wakeAnim | 0) % 2 === 0 ? ea.ships.barco1 : (ea.ships.barco4 || ea.ships.barco2);
          } else {
            const wakeCycle = ea.shipWakeCycle && ea.shipWakeCycle.length > 0 ? ea.shipWakeCycle : [ea.ships.barco4];
            const wIdx = (ship.wakeAnim | 0) % wakeCycle.length;
            sprite = wakeCycle[wIdx] || ea.ships.barco4;
          }
        }

        if (!sprite) continue;

        const drawW = Math.max(28, Math.round(ship.worldWidth * proj.scale));
        const aspect = sprite.height / sprite.width;
        const drawH = Math.max(9, Math.round(drawW * aspect));

        const drawX = Math.round(proj.screenX - drawW * 0.5);
        // Base de la línea de flotación asentada en el agua
        const drawY = Math.round(proj.screenY - drawH * 0.86);

        if (drawY + drawH > HORIZON_WORLD_Y && drawX + drawW > 0 && drawX < WORLD_W) {
          // Espuma y estela de proa del buque sobre el agua para asentar la línea de flotación
          const foamW = Math.round(drawW * 1.08);
          const foamX = Math.round(drawX - drawW * 0.04);
          const foamY = Math.round(proj.screenY - 1);
          const foamH = Math.max(1, (drawH * 0.07) | 0);
          ctx.fillStyle = "rgba(220, 245, 255, 0.50)";
          ctx.fillRect(foamX, foamY, foamW, foamH);

          ctx.drawImage(sprite, drawX, drawY, drawW, drawH);
        }
      }

      // 2. Renderizar los misiles Exocet AM-39 y sus estelas de humo en el espacio 3D
      if (Malvinas.newsgaming) {
        Malvinas.newsgaming.render(ctx, camera, projectWorldPoint);
      }
    },
  };

  // ==========================================================================
  // [40] LAYER_PLAYER — FORMACIÓN SUPER ÉTENDARD: LÍDER Y NUMERAL
  // ==========================================================================
  const LAYER_PLAYER = {
    name: "LAYER_PLAYER",
    zIndex: LAYER_Z_INDEX.LAYER_PLAYER,
    enabled: true,

    aircraftSprites: {},
    state: {
      screenX: VIEW_W * 0.5,
      screenY: VIEW_H * 0.77,
      visualRollRad: 0,
      shudderX: 0,
      shudderY: 0,
    },

    init(assets) {
      this.aircraftSprites = assets.aircraft || {};
    },

    update(dt, _camera, flight, timeSec) {
      if (!this.enabled) return;
      const st = this.state;

      const targetX = VIEW_W * 0.5 + flight.rollDeg * 3.4;
      const targetY =
        VIEW_H * 0.775 -
        flight.pitchDeg * 1.8 -
        Math.max(0, flight.throttle) * 7.0 +
        Math.sin(timeSec * 3.2) * 1.5;

      st.screenX += (targetX - st.screenX) * Math.min(1, 9 * dt);
      st.screenY += (targetY - st.screenY) * Math.min(1, 7 * dt);

      if (flight.altitudeMeters < 4.0 || flight.throttle > 0.35) {
        const amp = flight.altitudeMeters < 4.0 ? (4.0 - flight.altitudeMeters) * 0.8 : 0.8;
        st.shudderX = (Math.random() * 2 - 1) * amp;
        st.shudderY = (Math.random() * 2 - 1) * amp;
      } else {
        st.shudderX = 0;
        st.shudderY = 0;
      }

      st.visualRollRad = flight.rollRad * 1.35;
    },

    _selectSprite(flight, timeSec) {
      const sp = this.aircraftSprites;

      if (flight.rollDeg <= -7.2 && sp.AVION2) {
        const extraRoll = ((flight.rollDeg + 7.2) * Math.PI) / 180;
        return { img: sp.AVION2, angleRad: extraRoll * 0.85, scale: 0.52 };
      }
      if (flight.rollDeg >= 7.2 && sp.AVION6) {
        const extraRoll = ((flight.rollDeg - 7.2) * Math.PI) / 180;
        return { img: sp.AVION6, angleRad: extraRoll * 0.85, scale: 0.52 };
      }

      const useAfterburner =
        flight.throttle > 0.22 &&
        sp.AVION &&
        (flight.throttle > 0.55 || Math.sin(timeSec * 55) > -0.2);

      const baseImg = useAfterburner ? sp.AVION : sp.AVION1 || sp.AVION;

      return {
        img: baseImg,
        angleRad: this.state.visualRollRad,
        scale: 0.54,
      };
    },

    render(screenCtx, camera, flight, timeSec) {
      if (!this.enabled) return;

      const sp = this.aircraftSprites;
      const news = Malvinas.newsgaming;

      // ----------------------------------------------------------------------
      // 1. RENDERIZAR AL LÍDER (CC BEDACARRATZ) VOLANDO ADELANTE EN FORMACIÓN
      // ----------------------------------------------------------------------
      if (news && news.stage !== Malvinas.STAGES.BRIEFING) {
        const leaderEgressX = news.egressActive ? news.egressOffset * -2.4 : 0;
        const leaderEgressZ = news.egressActive ? news.egressOffset * 1.8 : 0;
        // Posicionado a Z=280 en el espacio 3D para escala proporcionada de compañero de vuelo
        const leaderProj = projectWorldPoint(-65 + leaderEgressX, 13.0, 260 + leaderEgressZ, camera);

        if (leaderProj && sp.AVION1) {
          const lImg = sp.AVION1;
          const lScale = leaderProj.scale * 0.42;
          const lW = Math.round(lImg.width * lScale);
          const lH = Math.round(lImg.height * lScale);

          // Coordenadas en pantalla proyectadas
          const lx = leaderProj.screenX - WORLD_CX + VIEW_W * 0.5;
          const ly = leaderProj.screenY - HORIZON_WORLD_Y + HORIZON_SCREEN_Y;

          screenCtx.save();
          screenCtx.translate(lx, ly);
          screenCtx.rotate(flight.rollRad * 0.85);

          // Sombra sutil del líder sobre el agua
          screenCtx.fillStyle = "rgba(4, 20, 48, 0.25)";
          screenCtx.beginPath();
          screenCtx.ellipse(0, lH * 0.65, lW * 0.4, 3, 0, 0, Math.PI * 2);
          screenCtx.fill();

          // Destello de tobera
          screenCtx.fillStyle = "rgba(255, 175, 45, 0.4)";
          screenCtx.beginPath();
          screenCtx.arc(0, lH * 0.2, 3, 0, Math.PI * 2);
          screenCtx.fill();

          screenCtx.drawImage(lImg, (-lW * 0.5) | 0, (-lH * 0.5) | 0, lW, lH);

          screenCtx.font = "bold 7px Consolas, monospace";
          screenCtx.fillStyle = "#57d7ff";
          screenCtx.textAlign = "center";
          screenCtx.fillText("LÍDER [BEDACARRATZ]", 0, -lH * 0.5 - 5);

          screenCtx.restore();
        }
      }

      // ----------------------------------------------------------------------
      // 2. RENDERIZAR AL AVIÓN DEL JUGADOR (TF ARMANDO MAYORA) EN PRIMER PLANO
      // ----------------------------------------------------------------------
      const sel = this._selectSprite(flight, timeSec);
      const st = this.state;
      const cx = Math.round(st.screenX + st.shudderX);
      const cy = Math.round(st.screenY + st.shudderY);

      // Sombra rasante de ala delta sobre el agua
      screenCtx.save();
      screenCtx.translate(cx, VIEW_H - 14);
      screenCtx.fillStyle = "rgba(3, 18, 42, 0.25)";
      screenCtx.beginPath();
      screenCtx.moveTo(0, -6);
      screenCtx.lineTo(46, 3);
      screenCtx.lineTo(12, 6);
      screenCtx.lineTo(-12, 6);
      screenCtx.lineTo(-46, 3);
      screenCtx.closePath();
      screenCtx.fill();
      screenCtx.restore();

      // Salpicadura de agua brava en rasante extremo (< 4m)
      if (flight.altitudeMeters < 4.2) {
        const sprayAlpha = Math.min(0.65, (4.2 - flight.altitudeMeters) / 3.8);
        screenCtx.fillStyle = `rgba(220, 245, 255, ${sprayAlpha})`;
        for (let i = 0; i < 6; i++) {
          const sx = cx + (Math.random() * 2 - 1) * 80;
          const sy = cy + 20 + Math.random() * 25;
          screenCtx.fillRect(sx, sy, 2 + Math.random() * 3, 2);
        }
      }

      // Vórtices de punta de ala
      if (Math.abs(flight.rollDeg) > 5.5 || flight.throttle > 0.5) {
        const wingSpan = 66;
        const cosR = Math.cos(st.visualRollRad);
        const sinR = Math.sin(st.visualRollRad);
        screenCtx.strokeStyle = "rgba(220, 246, 255, 0.45)";
        screenCtx.lineWidth = 1;
        for (const side of [-1, 1]) {
          const wx = cx + side * wingSpan * cosR;
          const wy = cy + side * wingSpan * sinR + 4;
          screenCtx.beginPath();
          screenCtx.moveTo(wx, wy);
          screenCtx.lineTo(wx + side * 14 - flight.rollInput * 8, wy + 22 + flight.throttle * 12);
          screenCtx.stroke();
        }
      }

      if (!sel.img) return;

      const drawW = Math.round(sel.img.width * sel.scale);
      const drawH = Math.round(sel.img.height * sel.scale);

      screenCtx.save();
      screenCtx.translate(cx, cy);
      screenCtx.rotate(sel.angleRad);

      if (flight.throttle > 0.45) {
        const pulse = 8 + Math.sin(timeSec * 48) * 3;
        screenCtx.fillStyle = "rgba(255, 168, 52, 0.35)";
        screenCtx.beginPath();
        screenCtx.arc(0, drawH * 0.24, pulse, 0, Math.PI * 2);
        screenCtx.fill();
      }

      // Exocet AM-39 bajo el pilón alar derecho
      if (news && !news.playerLaunched) {
        screenCtx.fillStyle = "#cbd5e1";
        screenCtx.fillRect(18, 6, 16, 4);
        screenCtx.fillStyle = "#ffffff";
        screenCtx.fillRect(20, 7, 12, 2);
      }

      screenCtx.drawImage(
        sel.img,
        (-drawW * 0.5) | 0,
        (-drawH * 0.5) | 0,
        drawW,
        drawH
      );

      screenCtx.restore();
    },
  };

  // ==========================================================================
  // [50] LAYER_HUD — AVIÓNICA HISTÓRICA, RADAR TÁCTICO & DIÁLOGOS DE MISIÓN
  // ==========================================================================
  const LAYER_HUD = {
    name: "LAYER_HUD",
    zIndex: LAYER_Z_INDEX.LAYER_HUD,
    enabled: true,

    radarSweepAngle: 0,

    init() {},

    update(dt) {
      if (!this.enabled) return;
      this.radarSweepAngle = (this.radarSweepAngle + dt * 2.8) % (Math.PI * 2);
    },

    render(ctx, camera, flight, enemiesLayer, pointerState) {
      if (!this.enabled) return;

      const news = Malvinas.newsgaming;
      if (!news) return;

      ctx.save();
      ctx.font = "bold 9px Consolas, monospace";
      ctx.textBaseline = "top";

      const green = "#4dff91";
      const cyan = "#57d7ff";
      const amber = "#ffbe42";
      const red = "#ff4d4d";

      // 1. Panel de vuelo
      ctx.fillStyle = "rgba(5, 14, 26, 0.75)";
      ctx.fillRect(10, 10, 168, 66);
      ctx.strokeStyle = "rgba(77, 255, 145, 0.45)";
      ctx.strokeRect(10.5, 10.5, 167, 65);

      ctx.fillStyle = green;
      ctx.fillText("SPD  " + String(flight.knots).padStart(3, "0") + " KTS", 16, 14);

      const alt = flight.altitudeMeters;
      const altStr = alt.toFixed(1).padStart(4, "0") + " M";

      if (alt > 15.0) {
        ctx.fillStyle = red;
        ctx.fillText("ALT  " + altStr + " [¡ALERTA RADAR!]", 16, 26);
      } else if (alt < 4.0) {
        ctx.fillStyle = amber;
        ctx.fillText("ALT  " + altStr + " [PELIGRO AGUA]", 16, 26);
      } else {
        ctx.fillStyle = green;
        ctx.fillText("ALT  " + altStr + " [RASANTE OK]", 16, 26);
      }

      ctx.fillStyle = "#12293f";
      ctx.fillRect(16, 40, 100, 6);
      const detW = Math.round((flight.detectionLevel / 100) * 100);
      ctx.fillStyle = flight.detectionLevel > 60 ? red : flight.detectionLevel > 30 ? amber : green;
      ctx.fillRect(16, 40, detW, 6);

      ctx.fillStyle = flight.detectionLevel > 50 ? red : cyan;
      ctx.fillText("RWR " + Math.round(flight.detectionLevel) + "%", 122, 38);

      ctx.fillStyle = "#12293f";
      ctx.fillRect(16, 52, 100, 5);
      const normThr = Math.max(0.08, (flight.throttle + 0.55) / 1.55);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : green;
      ctx.fillRect(16, 52, Math.round(100 * normThr), 5);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : cyan;
      ctx.fillText(flight.throttle > 0.35 ? "AB" : "MIL", 122, 50);

      // 2. Indicador de Alabeo
      const rollTxt = (flight.rollDeg >= 0 ? "+" : "") + flight.rollDeg.toFixed(1) + "°";
      ctx.fillStyle = "rgba(5, 14, 26, 0.65)";
      ctx.fillRect(VIEW_W * 0.5 - 56, 10, 112, 18);
      ctx.fillStyle = cyan;
      ctx.textAlign = "center";
      ctx.fillText("BANK " + rollTxt, VIEW_W * 0.5, 14);

      // 3. Colimador de tiro
      const pipX = Math.round(VIEW_W * 0.5 - flight.rollDeg * 1.6);
      const pipY = Math.round(HORIZON_SCREEN_Y + 26 - flight.pitchDeg * 2.2);

      ctx.save();
      ctx.translate(pipX, pipY);
      ctx.rotate(-flight.rollRad);

      ctx.strokeStyle = "rgba(77, 255, 145, 0.82)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(-14, 0);
      ctx.moveTo(14, 0);
      ctx.lineTo(34, 0);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = amber;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();

      // Marcador de blanco sobre el HMS Sheffield
      if (enemiesLayer && enemiesLayer.ships && enemiesLayer.ships[0]) {
        const ship = enemiesLayer.ships[0];
        const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
        if (proj) {
          const dx = proj.screenX - WORLD_CX;
          const dy = proj.screenY - HORIZON_WORLD_Y;
          const cosR = Math.cos(-camera.rollRad);
          const sinR = Math.sin(-camera.rollRad);
          const sx = VIEW_W * 0.5 + dx * cosR - dy * sinR;
          const sy = HORIZON_SCREEN_Y + dx * sinR + dy * cosR;

          if (sx > 20 && sx < VIEW_W - 20 && sy > 20 && sy < VIEW_H - 20) {
            const isHit = ship.damageState > 0;
            const isReadyToFire = news.stage === Malvinas.STAGES.COORDINATED_ATTACK && !news.playerLaunched;
            const targetFlash = Math.sin(Date.now() * 0.014) > 0;
            const boxColor = isHit ? red : (isReadyToFire ? (targetFlash ? "#ffffff" : amber) : amber);
            ctx.strokeStyle = boxColor;
            ctx.fillStyle = boxColor;
            ctx.lineWidth = 1;

            // Retícula militar de fijado con corchetes en las esquinas [  ] adaptada al destructor
            const targetW = Math.max(30, Math.round(ship.worldWidth * proj.scale * 1.06));
            const targetH = Math.max(12, Math.round(targetW * 0.32));
            const bX = Math.round(sx - targetW * 0.5);
            const bY = Math.round(sy - targetH * 0.84 - 3);
            const cLen = Math.min(6, Math.max(3, (targetW * 0.16) | 0));

            // Esquinas tácticas de fijado
            ctx.beginPath();
            // Superior izquierda
            ctx.moveTo(bX, bY + cLen);
            ctx.lineTo(bX, bY);
            ctx.lineTo(bX + cLen, bY);
            // Superior derecha
            ctx.moveTo(bX + targetW - cLen, bY);
            ctx.lineTo(bX + targetW, bY);
            ctx.lineTo(bX + targetW, bY + cLen);
            // Inferior izquierda
            ctx.moveTo(bX, bY + targetH - cLen);
            ctx.lineTo(bX, bY + targetH);
            ctx.lineTo(bX + cLen, bY + targetH);
            // Inferior derecha
            ctx.moveTo(bX + targetW - cLen, bY + targetH);
            ctx.lineTo(bX + targetW, bY + targetH);
            ctx.lineTo(bX + targetW, bY + targetH - cLen);
            ctx.stroke();

            const statusText = isHit
              ? "HMS SHEFFIELD: INCENDIO"
              : "HMS SHEFFIELD " + Math.round(ship.z) + "M";
            ctx.font = "bold 8px Consolas, monospace";
            ctx.textAlign = "center";
            ctx.fillText(statusText, sx, bY - 4);

            if (isReadyToFire) {
              ctx.fillStyle = targetFlash ? "#ffffff" : green;
              ctx.fillText(targetFlash ? "▶ DISPARO AUTORIZADO ◀" : "LOCK EXOCET AM-39", sx, bY + targetH + 8);
            }
          }
        }
      }

      // 4. Radar Táctico
      const radR = 30;
      const radCX = VIEW_W - 14 - radR;
      const radCY = 12 + radR;

      ctx.fillStyle = "rgba(4, 16, 22, 0.78)";
      ctx.beginPath();
      ctx.arc(radCX, radCY, radR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(77, 255, 145, 0.55)";
      ctx.beginPath();
      ctx.arc(radCX, radCY, radR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(radCX, radCY, radR * 0.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(77, 255, 145, 0.75)";
      ctx.beginPath();
      ctx.moveTo(radCX, radCY);
      ctx.lineTo(
        radCX + Math.cos(this.radarSweepAngle) * radR,
        radCY + Math.sin(this.radarSweepAngle) * radR
      );
      ctx.stroke();

      ctx.fillStyle = cyan;
      ctx.fillRect(radCX - 1, radCY + radR * 0.68, 3, 3);

      if (enemiesLayer && enemiesLayer.ships && enemiesLayer.ships[0]) {
        const s = enemiesLayer.ships[0];
        const nx = ((s.x - camera.x) / 1200) * (radR * 0.8);
        const nz = (s.z / Z_HORIZON_FAR) * (radR * 1.45);
        const bx = radCX + Math.max(-radR + 4, Math.min(radR - 4, nx));
        const by = radCY + radR * 0.68 - Math.max(0, Math.min(radR * 1.5, nz));
        ctx.fillStyle = s.damageState > 0 ? red : amber;
        ctx.fillRect(bx - 1, by - 1, 3, 3);
      }

      // 5. Banner de Radio Histórica (Ubicado en la franja superior sin obstruir el horizonte)
      if (news.radioBanner && news.radioBanner.timer > 0) {
        ctx.save();
        const bW = 460;
        const bH = 20;
        const bX = (VIEW_W - bW) * 0.5;
        const bY = 32;

        ctx.fillStyle = "rgba(4, 14, 28, 0.65)";
        ctx.fillRect(bX, bY, bW, bH);
        ctx.strokeStyle = "rgba(87, 215, 255, 0.40)";
        ctx.lineWidth = 1;
        ctx.strokeRect(bX + 0.5, bY + 0.5, bW - 1, bH - 1);

        ctx.font = "bold 8px Consolas, monospace";
        ctx.textAlign = "left";
        const prefix = "📻 " + news.radioBanner.speaker + ": ";
        ctx.fillStyle = "#ffbe42";
        ctx.fillText(prefix, bX + 8, bY + 5);

        const prefixW = ctx.measureText(prefix).width;
        ctx.fillStyle = "#e6f4ff";
        ctx.fillText(news.radioBanner.text, bX + 8 + prefixW, bY + 5);
        ctx.restore();
      }

      // 6. Prompt Táctico de Lanzamiento Exocet (Aviónica HUD inferior no obstructiva)
      if (news.stage === Malvinas.STAGES.COORDINATED_ATTACK && !news.playerLaunched) {
        ctx.save();
        const flash = Math.sin(Date.now() * 0.014) > 0;
        const pW = 290;
        const pH = 18;
        const pX = (VIEW_W - pW) * 0.5;
        const pY = 208; // Por debajo de la línea de mira al horizonte, dejando libre al destructor

        ctx.fillStyle = "rgba(4, 14, 28, 0.50)";
        ctx.fillRect(pX, pY, pW, pH);
        ctx.strokeStyle = flash ? "rgba(255, 190, 66, 0.85)" : "rgba(77, 255, 145, 0.60)";
        ctx.lineWidth = 1;
        ctx.strokeRect(pX + 0.5, pY + 0.5, pW - 1, pH - 1);

        ctx.font = "bold 9px Consolas, monospace";
        ctx.fillStyle = flash ? "#ffffff" : "#ffbe42";
        ctx.textAlign = "center";
        ctx.fillText("▶ LANZAR EXOCET [ESPACIO / GATILLO] ◀", VIEW_W * 0.5, pY + 4);
        ctx.restore();
      }

      // 7. Alertas de vuelo
      if (flight.altitudeMeters > 15.0) {
        const blink = (Date.now() % 360) < 180;
        if (blink) {
          ctx.font = "bold 11px Consolas, monospace";
          ctx.fillStyle = red;
          ctx.textAlign = "center";
          ctx.fillText("ALERTA: VUELO ALTO — BAJA A RASANTE INMEDIATAMENTE", VIEW_W * 0.5, 36);
        }
      } else if (flight.altitudeMeters < 3.8) {
        const blink = (Date.now() % 360) < 180;
        if (blink) {
          ctx.font = "bold 11px Consolas, monospace";
          ctx.fillStyle = amber;
          ctx.textAlign = "center";
          ctx.fillText("PELIGRO: DEMASIADO BAJO — RIESGO DE IMPACTO EN EL AGUA", VIEW_W * 0.5, 36);
        }
      }

      if (pointerState && pointerState.active) {
        ctx.strokeStyle = "rgba(87, 215, 255, 0.6)";
        ctx.beginPath();
        ctx.arc(pointerState.currX, pointerState.currY, 12, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    },
  };

  Malvinas.Config = {
    LAYER_Z_INDEX,
    VIEW_W,
    VIEW_H,
    WORLD_W,
    WORLD_H,
    WORLD_CX,
    HORIZON_SCREEN_Y,
    HORIZON_WORLD_Y,
    OCEAN_SCANLINES,
    CAMERA_BASE_HEIGHT,
    FOCAL_LENGTH,
    Z_HORIZON_FAR,
    Z_CLIP_NEAR,
  };

  Malvinas.createCameraState = createCameraState;
  Malvinas.projectWorldPoint = projectWorldPoint;

  Malvinas.Layers = {
    LAYER_BACKGROUND,
    LAYER_OCEAN,
    LAYER_ENEMIES,
    LAYER_PLAYER,
    LAYER_HUD,
  };
})(window);
