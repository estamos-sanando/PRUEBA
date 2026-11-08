/**
 * ============================================================================
 * MALVINAS 1982 — ARQUITECTURA MODULAR DE CAPAS (SEGA SUPER SCALER 16-BIT)
 * ============================================================================
 * Capas desacopladas por Z-Index (Requerimientos Técnicos #2 y #4):
 *
 *   [10] LAYER_BACKGROUND : Cielo crepuscular + islas con parallax y nubes.
 *   [20] LAYER_OCEAN      : Motor pseudo-3D de scanlines UV 1024x256 con doble
 *                           octava de detalle + olas 3D con escorzo real de
 *                           ángulo rasante y cobertura uniforme en frustum.
 *   [30] LAYER_ENEMIES    : Arreglo de destructores y buques enemigos en
 *                           coordenadas 3D simuladas (X, Y, Z) sobre el agua.
 *   [40] LAYER_PLAYER     : Avión caza centrado en primer plano con rotación y
 *                           sprites enlazados al alabeo y postcombustión.
 *   [50] LAYER_HUD        : Interfaz táctica (velocidad, altímetro radar,
 *                           horizonte artificial, radar naval y retícula).
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

  const OVERSCAN_X = 88;
  const OVERSCAN_Y = 84;
  const WORLD_W = VIEW_W + OVERSCAN_X * 2; // 816 px
  const WORLD_H = VIEW_H + OVERSCAN_Y * 2; // 528 px
  const WORLD_CX = WORLD_W >> 1; // 408 px
  const HORIZON_SCREEN_Y = 148;
  const HORIZON_WORLD_Y = HORIZON_SCREEN_Y + OVERSCAN_Y; // 232 px
  const OCEAN_SCANLINES = WORLD_H - HORIZON_WORLD_Y; // 296 scanlines

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

  /**
   * Proyección 3D -> 2D exacta sobre el plano del mar.
   * Inversa matemática exacta de las scanlines UV para anclaje perfecto al agua.
   */
  function projectWorldPoint(worldX, worldY, relZ, camera) {
    if (relZ <= Z_CLIP_NEAR || relZ > Z_HORIZON_FAR) return null;

    const projK = camera.y * FOCAL_LENGTH;
    const dyBias = projK / Z_HORIZON_FAR;
    const scale = FOCAL_LENGTH / relZ;
    const dySea = projK / relZ - dyBias;

    return {
      screenX: WORLD_CX + (worldX - camera.x) * scale,
      screenY: HORIZON_WORLD_Y + dySea - worldY * scale,
      scale: scale,
      dySea: dySea,
    };
  }

  // ==========================================================================
  // [10] LAYER_BACKGROUND — CIELO CREPUSCULAR CON ISLAS Y NUBES PARALLAX
  // ==========================================================================
  const LAYER_BACKGROUND = {
    name: "LAYER_BACKGROUND",
    zIndex: LAYER_Z_INDEX.LAYER_BACKGROUND,
    enabled: true,

    skySeamlessCanvas: null,
    skyTilePeriod: 1,
    skyDrawHeight: 196,
    cloudEntities: [],

    init(assets) {
      if (assets.skyCanvas) {
        const src = assets.skyCanvas;
        const aspect = src.width / src.height;
        const tileW = Math.round(this.skyDrawHeight * aspect);
        this.skyTilePeriod = tileW * 2;

        const c = document.createElement("canvas");
        c.width = this.skyTilePeriod;
        c.height = this.skyDrawHeight;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(src, 0, 0, tileW + 1, this.skyDrawHeight);
        ctx.save();
        ctx.translate(this.skyTilePeriod, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, tileW + 1, this.skyDrawHeight);
        ctx.restore();

        this.skySeamlessCanvas = c;
      }

      this.cloudEntities = [];
      const cloudSprites = assets.clouds || [];
      if (cloudSprites.length > 0) {
        const count = 14;
        for (let i = 0; i < count; i++) {
          const depthBand = i % 3;
          const sprite = cloudSprites[i % cloudSprites.length];
          this.cloudEntities.push({
            sprite,
            offsetX: (i / count) * 1500 - 750,
            altitudePx: 18 + depthBand * 36 + (i % 4) * 9,
            parallaxFactor: 0.42 + depthBand * 0.28,
            driftSpeed: (depthBand + 1) * 4.5 * (i % 2 === 0 ? 1 : -0.6),
            scale: 0.26 + depthBand * 0.11,
          });
        }
      }
    },

    update(dt) {
      if (!this.enabled) return;
      for (let i = 0; i < this.cloudEntities.length; i++) {
        const cl = this.cloudEntities[i];
        cl.offsetX += cl.driftSpeed * dt;
        if (cl.offsetX > 900) cl.offsetX -= 1800;
        if (cl.offsetX < -900) cl.offsetX += 1800;
      }
    },

    render(worldCtx, camera) {
      if (!this.enabled) {
        worldCtx.fillStyle = "#0b1628";
        worldCtx.fillRect(0, 0, WORLD_W, HORIZON_WORLD_Y + 2);
        return;
      }

      const horizonY = HORIZON_WORLD_Y;
      worldCtx.fillStyle = "#1f4c7d";
      worldCtx.fillRect(0, 0, WORLD_W, horizonY + 2);

      if (this.skySeamlessCanvas) {
        const period = this.skyTilePeriod;
        let scrollX = Math.round(camera.heading * 340) % period;
        if (scrollX < 0) scrollX += period;

        const drawY = horizonY - this.skyDrawHeight + 1;
        for (let x = -scrollX - period; x < WORLD_W + period; x += period) {
          worldCtx.drawImage(this.skySeamlessCanvas, x | 0, drawY | 0);
        }
      }

      for (let i = 0; i < this.cloudEntities.length; i++) {
        const cl = this.cloudEntities[i];
        const w = (cl.sprite.width * cl.scale) | 0;
        const h = (cl.sprite.height * cl.scale) | 0;
        let sx =
          WORLD_CX +
          ((cl.offsetX - camera.heading * 340 * cl.parallaxFactor) % 1600);
        if (sx < -700) sx += 1600;
        if (sx > WORLD_W + 700) sx -= 1600;

        const sy = horizonY - cl.altitudePx - h;
        if (sx + w > 0 && sx < WORLD_W && sy + h > 0) {
          worldCtx.drawImage(cl.sprite, sx | 0, sy | 0, w, h);
        }
      }
    },
  };

  // ==========================================================================
  // [20] LAYER_OCEAN — SCANLINES UV DOBLE OCTAVA + OLAS 3D CON ESCORZO REAL
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
    farSpawnAcc: 0,
    upperMidSpawnAcc: 0,
    midSpawnAcc: 0,
    nearSpawnAcc: 0,
    spraySpawnAcc: 0,
    nextWaveId: 1,

    init(assets) {
      this.oceanData = assets.ocean;
      this.waveAssets = assets.waves;

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

      // Poblar inicialmente 4 bandas de profundidad con olas pequeñas y sutiles
      this.waveEntities = [];
      for (let i = 0; i < 34; i++) {
        this._spawnWaveInBand("far", 1050 + (i / 34) * 1450, 0, 1.0, true);
      }
      for (let i = 0; i < 40; i++) {
        this._spawnWaveInBand("upperMid", 520 + (i / 40) * 530, 0, 1.0, true);
      }
      for (let i = 0; i < 48; i++) {
        this._spawnWaveInBand("mid", 220 + (i / 48) * 300, 0, 1.0, true);
      }
      for (let i = 0; i < 36; i++) {
        this._spawnWaveInBand("near", 58 + (i / 36) * 165, 0, 1.0, true);
      }
    },

    hotSwapAssets(newOceanData, newFrames) {
      if (newOceanData) this.oceanData = newOceanData;
      if (newFrames && newFrames.length >= 4) {
        this.waveAssets.swellLoop = newFrames;
        this.waveAssets.gentleSwell = newFrames;
        this.waveAssets.breakerRight = newFrames;
        this.waveAssets.breakerLeft = newFrames;
      }
    },

    /**
     * Genera una ola dentro del frustum horizontal visible a la distancia `zPos`.
     * Todas avanzan ancladas exactamente a la velocidad de las scanlines (`camera.currentSpeed`).
     */
    _spawnWaveInBand(band, zPos, cameraX, speedMult, prewarmed) {
      const wAssets = this.waveAssets;
      if (!wAssets) return;

      const corridorFactor = band === "near" ? 0.44 : 0.56;
      const frustumHalfW = (WORLD_W * corridorFactor * zPos) / FOCAL_LENGTH;
      const worldX = cameraX + (Math.random() * 2 - 1) * frustumHalfW;

      let frames = wAssets.swellLoop;
      let worldWidth = 24;
      let fps = 7.5;
      let loop = true;
      let maxLife = 99.0;
      let fadeInTime = 0.22;
      let kind = "swell";

      const r = Math.random();

      if (band === "far") {
        frames =
          wAssets.gentleSwell && wAssets.gentleSwell.length > 0
            ? wAssets.gentleSwell
            : wAssets.swellLoop;
        worldWidth = 12 + Math.random() * 9; // Olas lejanas: 12 a 21 unidades de mundo
        fps = 5.0 + Math.random() * 1.5;
        maxLife = 2.6 + Math.random() * 1.2;
        fadeInTime = 0.28;
        kind = "farSwell";
      } else if (band === "upperMid") {
        if (r < 0.68 && wAssets.swellLoop.length > 0) {
          frames = wAssets.swellLoop;
          worldWidth = 16 + Math.random() * 10; // Media-lejana: 16 a 26
          fps = 6.6 + Math.random() * 1.8;
          kind = "swell";
        } else {
          frames =
            Math.random() < 0.5 ? wAssets.breakerRight : wAssets.breakerLeft;
          worldWidth = 11 + Math.random() * 6; // 11 a 17
          fps = 7.2 + Math.random() * 1.8;
          kind = "breaker";
        }
        maxLife = 2.2 + Math.random() * 1.0;
        fadeInTime = 0.20;
      } else if (band === "mid") {
        if (r < 0.56 && wAssets.swellLoop.length > 0) {
          frames = wAssets.swellLoop;
          worldWidth = 19 + Math.random() * 11; // Media: 19 a 30
          fps = 7.6 + Math.random() * 2.0;
          kind = "swell";
        } else if (r < 0.84 && wAssets.breakerRight.length > 0) {
          frames =
            Math.random() < 0.5 ? wAssets.breakerRight : wAssets.breakerLeft;
          worldWidth = 13 + Math.random() * 7; // 13 a 20
          fps = 8.0 + Math.random() * 2.0;
          kind = "breaker";
        } else {
          frames =
            Math.random() < 0.5
              ? wAssets.crestToSplashRight
              : wAssets.crestToSplashLeft;
          worldWidth = 12 + Math.random() * 6; // 12 a 18
          fps = 8.8 + speedMult * 1.4;
          kind = "crestSplash";
        }
        maxLife = 1.9 + Math.random() * 0.9;
        fadeInTime = 0.16;
      } else {
        // Banda cercana / primer plano: sutiles rizos y crestas que fluyen bajo el avión
        if (r < 0.52 && wAssets.swellLoop.length > 0) {
          frames = wAssets.swellLoop;
          worldWidth = 24 + Math.random() * 14; // Cercana: 24 a 38
          fps = 8.6 + Math.random() * 2.2;
          kind = "swell";
        } else if (r < 0.82 && wAssets.breakerRight.length > 0) {
          frames =
            Math.random() < 0.5 ? wAssets.breakerRight : wAssets.breakerLeft;
          worldWidth = 15 + Math.random() * 8; // 15 a 23
          fps = 9.0 + Math.random() * 2.2;
          kind = "breaker";
        } else {
          frames =
            Math.random() < 0.5
              ? wAssets.crestToSplashRight
              : wAssets.crestToSplashLeft;
          worldWidth = 14 + Math.random() * 7; // 14 a 21
          fps = 10.0 + speedMult * 1.6;
          kind = "crestSplash";
        }
        maxLife = 1.5 + Math.random() * 0.8;
        fadeInTime = 0.10;
      }

      if (!frames || frames.length === 0) return;

      this.waveEntities.push({
        id: this.nextWaveId++,
        kind,
        frames,
        frameIndex: prewarmed ? Math.random() * frames.length : Math.random() * 1.8,
        fps,
        loop,
        x: worldX,
        y: 0,
        z: zPos,
        worldWidth,
        age: prewarmed ? 0.35 + Math.random() * 0.9 : 0.0,
        fadeInTime,
        maxLife,
        lateralDrift: (Math.random() - 0.5) * 8,
      });
    },

    _spawnJetWashSpray(cameraX, speedMult) {
      const wAssets = this.waveAssets;
      if (!wAssets || wAssets.splashRight.length === 0) return;

      const side = Math.random() < 0.5 ? -1 : 1;
      const frames = side < 0 ? wAssets.splashLeft : wAssets.splashRight;

      this.waveEntities.push({
        id: this.nextWaveId++,
        kind: "spray",
        frames,
        frameIndex: 0,
        fps: 11 + speedMult * 2.5,
        loop: false,
        x: cameraX + side * (14 + Math.random() * 38),
        y: 0,
        z: 95 + Math.random() * 105,
        worldWidth: 9 + Math.random() * 5,
        age: 0.15,
        fadeInTime: 0.1,
        maxLife: 1.1,
        lateralDrift: side * 22,
      });
    },

    update(dt, camera, flight, timeSec) {
      if (!this.enabled) return;

      const dz = camera.currentSpeed * dt;
      const speedMult = flight.speedMultiplier;

      for (let i = this.waveEntities.length - 1; i >= 0; i--) {
        const w = this.waveEntities[i];
        w.z -= dz;
        w.x += w.lateralDrift * dt;
        w.age += dt;
        w.frameIndex += w.fps * (0.85 + speedMult * 0.2) * dt;

        if (w.loop) {
          if (w.frameIndex >= w.frames.length) {
            w.frameIndex %= w.frames.length;
          }
        } else if (w.frameIndex >= w.frames.length) {
          this.waveEntities.splice(i, 1);
          continue;
        }

        if (w.z <= Z_CLIP_NEAR || w.age >= w.maxLife) {
          this.waveEntities.splice(i, 1);
        }
      }

      const rateScale = Math.pow(speedMult, 1.15);
      const maxWaves = 250;

      this.farSpawnAcc += 14.0 * rateScale * dt;
      while (this.farSpawnAcc >= 1.0) {
        this.farSpawnAcc -= 1.0;
        if (this.waveEntities.length < maxWaves) {
          this._spawnWaveInBand("far", 1100 + Math.random() * 1400, camera.x, speedMult, false);
        }
      }

      this.upperMidSpawnAcc += 22.0 * rateScale * dt;
      while (this.upperMidSpawnAcc >= 1.0) {
        this.upperMidSpawnAcc -= 1.0;
        if (this.waveEntities.length < maxWaves) {
          this._spawnWaveInBand("upperMid", 560 + Math.random() * 540, camera.x, speedMult, false);
        }
      }

      this.midSpawnAcc += 32.0 * rateScale * dt;
      while (this.midSpawnAcc >= 1.0) {
        this.midSpawnAcc -= 1.0;
        if (this.waveEntities.length < maxWaves) {
          this._spawnWaveInBand("mid", 290 + Math.random() * 310, camera.x, speedMult, false);
        }
      }

      this.nearSpawnAcc += 30.0 * rateScale * dt;
      while (this.nearSpawnAcc >= 1.0) {
        this.nearSpawnAcc -= 1.0;
        if (this.waveEntities.length < maxWaves) {
          this._spawnWaveInBand("near", 165 + Math.random() * 175, camera.x, speedMult, false);
        }
      }

      if (flight.throttle > 0.25) {
        this.spraySpawnAcc += flight.throttle * 14.0 * dt;
        while (this.spraySpawnAcc >= 1.0) {
          this.spraySpawnAcc -= 1.0;
          if (this.waveEntities.length < maxWaves) {
            this._spawnJetWashSpray(camera.x, speedMult);
          }
        }
      }

      this._lastTimeSec = timeSec;
    },

    _renderScanlineSurface(worldCtx, camera) {
      const od = this.oceanData;
      if (!od) return;

      const tex32 = od.tex32;
      const maskU = od.texMaskU;
      const maskV = od.texMaskV;
      const shiftV = od.texShiftV;
      const out32 = this.scanlineBuf32;
      const horizonLUT = od.horizonLUT;
      const lutMax = od.horizonLUTSize - 1;

      const projK = camera.y * FOCAL_LENGTH;
      const dyBias = projK / Z_HORIZON_FAR;
      const timeSec = this._lastTimeSec || 0;

      // Alta densidad UV para evitar bloques estirados en primer plano
      const U_SCALE = 5.6;
      const V_SCALE = 4.4;
      const camX = camera.x;
      const camZ = camera.z;
      const fineDriftOffset = ((timeSec * 34) | 0) & maskU;

      let outIdx = 0;

      for (let dy = 0; dy < OCEAN_SCANLINES; dy++) {
        const z = projK / (dy + dyBias);
        const invScale = z / FOCAL_LENGTH;

        const swellWaveX =
          Math.sin(z * 0.055 - timeSec * 3.5) * (1.8 * Math.min(1, 220 / z));

        const vCoord = ((camZ + z) * V_SCALE) | 0;
        const vRowOffset = (vCoord & maskV) << shiftV;

        const worldLeftX = camX - WORLD_CX * invScale + swellWaveX;
        let uFixed = (worldLeftX * U_SCALE * 65536.0) | 0;
        const stepUFixed = (invScale * U_SCALE * 65536.0) | 0;

        if (dy < 46) {
          const lutIdx = ((dy / 45) * lutMax) | 0;
          const hr = horizonLUT[lutIdx * 3];
          const hg = horizonLUT[lutIdx * 3 + 1];
          const hb = horizonLUT[lutIdx * 3 + 2];
          const fogWeight = (((46 - dy) * 232) / 46) | 0;
          const texWeight = 256 - fogWeight;

          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;

            const c = tex32[vRowOffset + tu];
            const r = ((c & 0xff) * texWeight + hr * fogWeight) >> 8;
            const g = (((c >> 8) & 0xff) * texWeight + hg * fogWeight) >> 8;
            const b = (((c >> 16) & 0xff) * texWeight + hb * fogWeight) >> 8;

            out32[outIdx++] = 0xff000000 | (b << 16) | (g << 8) | r;
          }
        } else if (dy < 115) {
          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;
            out32[outIdx++] = tex32[vRowOffset + tu];
          }
        } else {
          // Primer plano: inserta destellos nítidos de paleta pura (sin punteado borroso)
          const vRowFine = ((vCoord * 2 + 83) & maskV) << shiftV;
          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            const tuFine = ((uFixed >> 15) + fineDriftOffset) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;

            const c1 = tex32[vRowOffset + tu];
            const c2 = tex32[vRowFine + tuFine];
            out32[outIdx++] =
              ((c2 >> 8) & 0xff) > ((c1 >> 8) & 0xff) + 18 ? c2 : c1;
          }
        }
      }

      this.scanlineCtx.putImageData(this.scanlineImgData, 0, 0);
      worldCtx.drawImage(this.scanlineCanvas, 0, HORIZON_WORLD_Y);

      worldCtx.fillStyle = "rgba(155, 228, 255, 0.35)";
      worldCtx.fillRect(0, HORIZON_WORLD_Y, WORLD_W, 1);
    },

    _renderDynamicWaves(worldCtx, camera) {
      if (!this.wavesEnabled || this.waveEntities.length === 0) return;

      this.waveEntities.sort((a, b) => b.z - a.z);

      for (let i = 0; i < this.waveEntities.length; i++) {
        const w = this.waveEntities[i];
        const proj = projectWorldPoint(w.x, w.y, w.z, camera);
        if (!proj || proj.dySea < 1.5) continue;

        const frame = w.frames[(w.frameIndex | 0) % w.frames.length];
        if (!frame) continue;

        let alpha = 1.0;
        if (w.age < w.fadeInTime) {
          alpha *= w.age / w.fadeInTime;
        }
        const remLife = w.maxLife - w.age;
        if (remLife < 0.38) {
          alpha *= Math.max(0, remLife / 0.38);
        }
        if (w.z > Z_HORIZON_FAR - 420) {
          alpha *= Math.max(0.14, (Z_HORIZON_FAR - w.z) / 420);
        }
        if (alpha <= 0.03) continue;

        const drawW = Math.max(3, Math.round(w.worldWidth * proj.scale));
        const drawX = Math.round(proj.screenX - drawW * 0.5);
        if (drawX + drawW < 0 || drawX > WORLD_W) continue;

        // En lejanía extrema (`dySea < 13`), renderizar destellos limpios de espuma blanca/cian
        // evitando que el submuestreo nearest-neighbor produzca rayas oscuras en el horizonte
        if (proj.dySea < 13) {
          const glintY = Math.max(HORIZON_WORLD_Y + 2, Math.round(proj.screenY));
          worldCtx.globalAlpha = alpha * 0.65;
          worldCtx.fillStyle = proj.dySea < 6 ? "#9be6ff" : "#dcf8ff";
          worldCtx.fillRect(drawX, glintY, drawW, 1);
          if (proj.dySea >= 7) {
            worldCtx.globalAlpha = alpha * 0.38;
            worldCtx.fillStyle = "#52beee";
            worldCtx.fillRect(drawX + 2, glintY + 1, Math.max(2, drawW - 4), 1);
          }
          continue;
        }

        // Escorzo vertical progresivo natural para vista aérea rasante (olas bajas y proporcionadas)
        const grazingFactor =
          w.kind === "spray"
            ? 0.40
            : w.kind === "swell" || w.kind === "farSwell"
              ? 0.05 + 0.12 * Math.min(1.0, Math.pow(proj.dySea / 175.0, 0.75))
              : 0.07 + 0.16 * Math.min(1.0, Math.pow(proj.dySea / 165.0, 0.72));

        const rawAspect = frame.height / frame.width;
        const drawH = Math.max(
          1,
          Math.round(drawW * rawAspect * grazingFactor)
        );

        const drawY = Math.max(
          HORIZON_WORLD_Y + 2,
          Math.round(proj.screenY - drawH * 0.65)
        );
        if (drawY > WORLD_H) continue;

        // Estela sutil de espuma blanca sobre la superficie de contacto
        if (proj.dySea > 24 && drawW >= 14 && w.kind !== "spray") {
          worldCtx.globalAlpha = alpha * 0.28;
          worldCtx.fillStyle = "#c8f4ff";
          const foamW = Math.round(drawW * 0.65);
          const foamX = Math.round(proj.screenX - foamW * 0.5);
          worldCtx.fillRect(foamX, Math.round(proj.screenY - 1), foamW, 1);
        }

        worldCtx.globalAlpha = alpha;
        worldCtx.drawImage(frame, drawX, drawY, drawW, drawH);
      }

      worldCtx.globalAlpha = 1.0;
    },

    render(worldCtx, camera) {
      if (!this.enabled) {
        worldCtx.fillStyle = "#062a54";
        worldCtx.fillRect(0, HORIZON_WORLD_Y, WORLD_W, OCEAN_SCANLINES);
        return;
      }

      this._renderScanlineSurface(worldCtx, camera);
      this._renderDynamicWaves(worldCtx, camera);
    },
  };

  // ==========================================================================
  // [30] LAYER_ENEMIES — BUQUES Y DESTRUCTORES EN COORDENADAS 3D (X, Y, Z)
  // ==========================================================================
  const LAYER_ENEMIES = {
    name: "LAYER_ENEMIES",
    zIndex: LAYER_Z_INDEX.LAYER_ENEMIES,
    enabled: true,

    enemyAssets: null,
    sprites: {},
    wakeFrames: [],
    ships: [],

    init(assets) {
      this.enemyAssets = assets.enemies || null;
      this.sprites.type42 = assets.enemies
        ? assets.enemies.type42Destroyer
        : null;
      this.wakeFrames =
        assets.waves && assets.waves.breakerRight
          ? assets.waves.breakerRight
          : [];

      // Flota naval británica en patrulla sobre el Atlántico Sur (HMS Sheffield D80, Glasgow D88, Antelope)
      this.ships = [
        {
          id: "D-80",
          designation: "HMS SHEFFIELD (D80)",
          type: "D80",
          x: -110,
          y: 0,
          z: 1650,
          vx: 14,
          vz: -32,
          worldWidth: 145,
          style: "side",
          wakeAnim: 0,
          hp: 100,
          damageState: 0,
          explosionFrame: 0,
        },
        {
          id: "D-88",
          designation: "HMS GLASGOW (D88)",
          type: "D80",
          x: 230,
          y: 0,
          z: 2280,
          vx: -10,
          vz: -22,
          worldWidth: 145,
          style: "angled",
          wakeAnim: 2.2,
          hp: 100,
          damageState: 0,
          explosionFrame: 0,
        },
        {
          id: "F-170",
          designation: "HMS ANTELOPE (F170)",
          type: "FRIGATE",
          x: -390,
          y: 0,
          z: 2520,
          vx: 16,
          vz: -38,
          worldWidth: 135,
          style: "side",
          wakeAnim: 4.1,
          hp: 100,
          damageState: 0,
          explosionFrame: 0,
        },
      ];
    },

    registerEnemySprite(typeKey, spriteCanvasOrImage) {
      this.sprites[typeKey] = spriteCanvasOrImage;
    },

    /**
     * Dispara un impacto directo sobre el contacto naval más cercano en mira (o targetId),
     * activando la secuencia de explosión, fuego, humo y hundimiento (`barcoexplota`..`9`).
     */
    triggerAttack(targetId) {
      let target = null;
      if (targetId) {
        target = this.ships.find((s) => s.id === targetId);
      }
      if (!target) {
        // Encontrar el buque más cercano al centro y a distancia de tiro
        let bestScore = Infinity;
        for (let i = 0; i < this.ships.length; i++) {
          const s = this.ships[i];
          if (s.z > 70 && s.z < 2200) {
            const score = s.z + Math.abs(s.x) * 2;
            if (score < bestScore) {
              bestScore = score;
              target = s;
            }
          }
        }
      }

      if (target) {
        target.damageState = 1;
        target.explosionFrame = 0;
        target.hp = 0;
        return target;
      }
      return null;
    },

    update(dt, camera, _flight, timeSec) {
      if (!this.enabled) return;
      const approachDz = camera.currentSpeed * dt;
      this._lastTimeSec = timeSec;

      for (let i = 0; i < this.ships.length; i++) {
        const ship = this.ships[i];
        ship.z -= approachDz - ship.vz * dt;
        ship.x += ship.vx * dt;
        ship.wakeAnim = (ship.wakeAnim + 7 * dt) % 5;

        // Progresión de la animación de impacto, fuego y hundimiento
        if (ship.damageState > 0) {
          const maxFrames =
            this.enemyAssets && this.enemyAssets.explosionSequence
              ? this.enemyAssets.explosionSequence.length
              : 9;
          // Reproducir a ~2.4 fps para dramatismo cinematográfico del combate
          ship.explosionFrame = Math.min(
            maxFrames - 1,
            ship.explosionFrame + dt * 2.3
          );
        }

        // Reubicar buque cuando queda detrás del avión o hundido tras pasar
        if (ship.z < Z_CLIP_NEAR + 10) {
          ship.z = Z_HORIZON_FAR - 40 - Math.random() * 320;
          ship.x = camera.x + (Math.random() * 2 - 1) * 640;
          ship.damageState = 0;
          ship.explosionFrame = 0;
          ship.hp = 100;
        }
      }
    },

    render(worldCtx, camera) {
      if (!this.enabled || this.ships.length === 0) return;

      const sorted = this.ships.slice().sort((a, b) => b.z - a.z);
      const ea = this.enemyAssets;
      const timeSec = this._lastTimeSec || 0;

      for (let i = 0; i < sorted.length; i++) {
        const ship = sorted[i];
        const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
        if (!proj) continue;

        // Selección dinámica de LOD, perspectiva (frontal 3/4 o lateral) y estado de daño
        let sprite = null;

        if (ship.damageState > 0 && ea && ea.explosionSequence && ea.explosionSequence.length > 0) {
          const seq =
            ship.vx < 0 ? ea.explosionSequenceFlipped : ea.explosionSequence;
          const fIdx = Math.min(seq.length - 1, ship.explosionFrame | 0);
          sprite = seq[fIdx];
        } else if (ea && ea.ships) {
          const sMap = ship.vx < 0 ? ea.shipsFlipped : ea.ships;
          if (ship.z > 1300) {
            sprite = sMap.barcolejos || sMap.barco;
          } else if (ship.z > 680) {
            sprite = sMap.barco2 || sMap.barco1 || sMap.barco;
          } else {
            if (ship.style === "angled" && (sMap.barco5 || sMap.barco6)) {
              // Vista 3/4 frontal cabeceando suavemente en el oleaje
              const bob = ((timeSec * 2.2) | 0) % 2;
              sprite = bob === 0 ? sMap.barco5 : sMap.barco6 || sMap.barco5;
            } else {
              // Vista de perfil con estela de proa/popa animada en loop
              const wCycle =
                ship.vx < 0 ? ea.shipWakeCycleFlipped : ea.shipWakeCycle;
              if (wCycle && wCycle.length > 0) {
                sprite = wCycle[(ship.wakeAnim | 0) % wCycle.length];
              } else {
                sprite = sMap.barco4 || sMap.barco;
              }
            }
          }
        }

        if (!sprite) sprite = this.sprites[ship.type];
        if (!sprite) continue;

        const drawW = Math.max(5, Math.round(ship.worldWidth * proj.scale));
        const drawH = Math.max(
          3,
          Math.round(drawW * (sprite.height / sprite.width))
        );
        const drawX = Math.round(proj.screenX - drawW * 0.5);
        // Anclaje de flotación exacta sobre el nivel del mar
        const drawY = Math.round(proj.screenY - drawH * 0.94);

        if (drawX + drawW < 0 || drawX > WORLD_W) continue;

        // Sombra de casco sobre el agua
        worldCtx.fillStyle = "rgba(2, 14, 34, 0.45)";
        worldCtx.fillRect(
          (drawX + drawW * 0.06) | 0,
          Math.round(proj.screenY - 1),
          (drawW * 0.88) | 0,
          Math.max(2, (drawH * 0.08) | 0)
        );

        // Entrada atmosférica suave desde el horizonte
        if (ship.z > Z_HORIZON_FAR - 280) {
          worldCtx.globalAlpha = Math.max(
            0.25,
            (Z_HORIZON_FAR - ship.z) / 280
          );
          worldCtx.drawImage(sprite, drawX, drawY, drawW, drawH);
          worldCtx.globalAlpha = 1.0;
        } else {
          worldCtx.drawImage(sprite, drawX, drawY, drawW, drawH);
        }
      }
    },
  };

  // ==========================================================================
  // [40] LAYER_PLAYER — CAZA EN PRIMER PLANO ENLAZADO AL ALABEO Y TURBO
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

    setAircraftSprites(spriteMap) {
      Object.assign(this.aircraftSprites, spriteMap);
    },

    update(dt, _camera, flight, timeSec) {
      if (!this.enabled) return;
      const st = this.state;

      const targetX = VIEW_W * 0.5 + flight.rollDeg * 3.4;
      const targetY =
        VIEW_H * 0.775 -
        Math.max(0, flight.throttle) * 8.0 +
        Math.sin(timeSec * 3.2) * 1.8;

      st.screenX += (targetX - st.screenX) * Math.min(1, 9 * dt);
      st.screenY += (targetY - st.screenY) * Math.min(1, 7 * dt);

      if (flight.throttle > 0.35) {
        const amp = (flight.throttle - 0.35) * 1.6;
        st.shudderX = (Math.random() * 2 - 1) * amp;
        st.shudderY = (Math.random() * 2 - 1) * amp;
      } else {
        st.shudderX = 0;
        st.shudderY = 0;
      }

      st.visualRollRad = flight.rollRad * 1.35;
    },

    _selectSpriteAndAngle(flight, timeSec) {
      const sp = this.aircraftSprites;

      if (flight.barrelRollTimer > 0) {
        const p = 1.0 - flight.barrelRollTimer / 0.62;
        const seq =
          flight.barrelRollDir > 0
            ? ["AVION2", "AVION3", "AVION5", "AVION4", "AVION6"]
            : ["AVION6", "AVION4", "AVION5", "AVION3", "AVION2"];
        const key = seq[Math.min(seq.length - 1, (p * seq.length) | 0)];
        if (sp[key]) {
          return {
            img: sp[key],
            angleRad: p * Math.PI * 2 * flight.barrelRollDir * 0.18,
            scale: 0.48,
          };
        }
      }

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

    render(screenCtx, _camera, flight, timeSec) {
      if (!this.enabled) return;

      const sel = this._selectSpriteAndAngle(flight, timeSec);
      const st = this.state;
      const cx = Math.round(st.screenX + st.shudderX);
      const cy = Math.round(st.screenY + st.shudderY);

      // Sombra proyectada sutil con silueta de ala delta sobre el agua
      screenCtx.save();
      screenCtx.translate(cx, VIEW_H - 16);
      screenCtx.fillStyle = "rgba(3, 18, 42, 0.24)";
      screenCtx.beginPath();
      screenCtx.moveTo(0, -7);
      screenCtx.lineTo(44, 3);
      screenCtx.lineTo(10, 6);
      screenCtx.lineTo(-10, 6);
      screenCtx.lineTo(-44, 3);
      screenCtx.closePath();
      screenCtx.fill();
      screenCtx.restore();

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
          screenCtx.lineTo(
            wx + side * 14 - flight.rollInput * 8,
            wy + 22 + flight.throttle * 12
          );
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
        screenCtx.fillStyle = "rgba(255, 168, 52, 0.28)";
        screenCtx.beginPath();
        screenCtx.arc(0, drawH * 0.24, pulse, 0, Math.PI * 2);
        screenCtx.fill();
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
  // [50] LAYER_HUD — AVIÓNICA TÁCTICA 16 BITS (VELOCIDAD, RADAR, RETÍCULA)
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

      ctx.save();
      ctx.font = "bold 9px Consolas, monospace";
      ctx.textBaseline = "top";

      const green = "#4dff91";
      const cyan = "#57d7ff";
      const amber = "#ffbe42";

      ctx.fillStyle = "rgba(5, 14, 26, 0.68)";
      ctx.fillRect(10, 10, 134, 52);
      ctx.strokeStyle = "rgba(77, 255, 145, 0.45)";
      ctx.strokeRect(10.5, 10.5, 133, 51);

      ctx.fillStyle = green;
      ctx.fillText(
        "SPD  " + String(flight.knots).padStart(3, "0") + " KTS",
        16,
        15
      );

      const altStr = flight.altitudeMeters.toFixed(1).padStart(4, "0");
      ctx.fillStyle = flight.altitudeMeters < 9.5 ? amber : green;
      ctx.fillText("ALT  " + altStr + " M  RASANTE", 16, 28);

      ctx.fillStyle = "#12293f";
      ctx.fillRect(16, 43, 84, 6);
      const normThr = Math.max(0.08, (flight.throttle + 0.55) / 1.55);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : green;
      ctx.fillRect(16, 43, Math.round(84 * normThr), 6);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : cyan;
      ctx.fillText(flight.throttle > 0.35 ? "AB" : "MIL", 105, 41);

      const rollTxt =
        (flight.rollDeg >= 0 ? "+" : "") + flight.rollDeg.toFixed(1) + "°";
      ctx.fillStyle = "rgba(5, 14, 26, 0.62)";
      ctx.fillRect(VIEW_W * 0.5 - 56, 10, 112, 18);
      ctx.fillStyle = cyan;
      ctx.textAlign = "center";
      ctx.fillText("BANK " + rollTxt, VIEW_W * 0.5, 14);

      const pipX = Math.round(VIEW_W * 0.5 - flight.rollDeg * 1.6);
      const pipY = Math.round(HORIZON_SCREEN_Y + 26 - flight.throttle * 6);

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

      if (enemiesLayer && enemiesLayer.enabled) {
        ctx.font = "bold 8px Consolas, monospace";
        for (let i = 0; i < enemiesLayer.ships.length; i++) {
          const ship = enemiesLayer.ships[i];
          if (ship.z > 2100 || ship.z < 80) continue;
          const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
          if (!proj) continue;

          const dx = proj.screenX - WORLD_CX;
          const dy = proj.screenY - HORIZON_WORLD_Y;
          const cosR = Math.cos(-camera.rollRad);
          const sinR = Math.sin(-camera.rollRad);
          const sx = VIEW_W * 0.5 + dx * cosR - dy * sinR;
          const sy = HORIZON_SCREEN_Y + dx * sinR + dy * cosR;

          if (sx > 20 && sx < VIEW_W - 20 && sy > 20 && sy < VIEW_H - 20) {
            const isHit = ship.damageState > 0;
            const boxColor = isHit ? "#ff4d4d" : amber;
            ctx.strokeStyle = boxColor;
            ctx.fillStyle = boxColor;

            const box = Math.max(12, Math.min(34, (200 * proj.scale) | 0));
            ctx.strokeRect(
              Math.round(sx - box * 0.5) + 0.5,
              Math.round(sy - box * 0.65) + 0.5,
              box,
              box
            );

            const statusText = isHit
              ? ship.id + " SINKING"
              : ship.id + " " + Math.round(ship.z) + "M";
            ctx.fillText(statusText, sx, sy - box * 0.65 - 10);
          }
        }
      }

      const radR = 30;
      const radCX = VIEW_W - 14 - radR;
      const radCY = 12 + radR;

      ctx.fillStyle = "rgba(4, 16, 22, 0.76)";
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

      ctx.strokeStyle = "rgba(77, 255, 145, 0.25)";
      ctx.beginPath();
      ctx.moveTo(radCX, radCY + radR * 0.75);
      ctx.lineTo(radCX - radR * 0.65, radCY - radR * 0.65);
      ctx.moveTo(radCX, radCY + radR * 0.75);
      ctx.lineTo(radCX + radR * 0.65, radCY - radR * 0.65);
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

      if (enemiesLayer && enemiesLayer.enabled) {
        ctx.fillStyle = amber;
        for (let i = 0; i < enemiesLayer.ships.length; i++) {
          const s = enemiesLayer.ships[i];
          const nx = ((s.x - camera.x) / 1200) * (radR * 0.8);
          const nz = (s.z / Z_HORIZON_FAR) * (radR * 1.45);
          const bx = radCX + Math.max(-radR + 4, Math.min(radR - 4, nx));
          const by =
            radCY + radR * 0.68 - Math.max(0, Math.min(radR * 1.5, nz));
          ctx.fillRect(bx - 1, by - 1, 3, 3);
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
