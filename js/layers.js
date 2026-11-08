/**
 * ============================================================================
 * MALVINAS 1982 — ARQUITECTURA MODULAR DE CAPAS (SEGA SUPER SCALER 16-BIT)
 * ============================================================================
 * Capas desacopladas por Z-Index (Requerimientos Técnicos #2 y #4):
 *
 *   [10] LAYER_BACKGROUND : Cielo crepuscular + islas con parallax y nubes.
 *   [20] LAYER_OCEAN      : Motor pseudo-3D de scanlines UV con perspectiva 1/Z
 *                           hiperbólica + sprites dinámicos de olas en loop.
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

  // --------------------------------------------------------------------------
  // CONSTANTES GLOBALES DE CAPAS (Z-INDEX) Y PROYECCIÓN 3D COMPARTIDA
  // --------------------------------------------------------------------------
  const LAYER_Z_INDEX = Object.freeze({
    LAYER_BACKGROUND: 10,
    LAYER_OCEAN: 20,
    LAYER_ENEMIES: 30,
    LAYER_PLAYER: 40,
    LAYER_HUD: 50,
  });

  // Resolución interna pixel-art panorámica 16:9 (escala nítida a Fullscreen)
  const VIEW_W = 640;
  const VIEW_H = 360;

  // Buffer de mundo con overscan para rotar la cámara ±12° sin revelar bordes vacíos
  const OVERSCAN_X = 88;
  const OVERSCAN_Y = 84;
  const WORLD_W = VIEW_W + OVERSCAN_X * 2; // 816 px
  const WORLD_H = VIEW_H + OVERSCAN_Y * 2; // 528 px
  const WORLD_CX = WORLD_W >> 1; // 408 px
  const HORIZON_SCREEN_Y = 148; // Línea de horizonte en coordenadas de pantalla (640x360)
  const HORIZON_WORLD_Y = HORIZON_SCREEN_Y + OVERSCAN_Y; // 232 px dentro del buffer de mundo
  const OCEAN_SCANLINES = WORLD_H - HORIZON_WORLD_Y; // 296 scanlines de océano

  // Constantes físicas de cámara Super Scaler (compartidas por scanlines, olas y buques)
  const CAMERA_BASE_HEIGHT = 52.0;
  const FOCAL_LENGTH = 252.0;
  const Z_HORIZON_FAR = 2650.0;
  const Z_CLIP_NEAR = 28.0;

  /**
   * Estado global de la cámara 3D sobre el mar.
   */
  function createCameraState() {
    return {
      x: 0.0, // Posición lateral en el océano (desliza al alabear Izq/Der)
      y: CAMERA_BASE_HEIGHT, // Altura sobre el nivel del mar
      z: 0.0, // Avance acumulado hacia adelante
      heading: 0.0, // Rumbo acumulado para parallax horizontal del cielo
      forwardSpeed: 690.0, // Unidades 3D / segundo en crucero
      currentSpeed: 690.0,
      pitchOffsetPx: 0.0,
      rollRad: 0.0,
      rollDeg: 0.0,
    };
  }

  /**
   * Proyección 3D -> 2D exacta sobre el buffer de mundo (`WORLD_W x WORLD_H`).
   * Es la inversa matemática exacta del motor de scanlines UV, garantizando que
   * olas y buques enemigos queden 100% anclados sobre la superficie del agua
   * sin patinar ("ice-skating") al girar o acelerar.
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
      // Construye tira horizontal seamless [cielo | espejo(cielo)] para rotación continua 360°
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

        // Mitad A: original | Mitad B: espejada (une las islas sin corte vertical)
        ctx.drawImage(src, 0, 0, tileW, this.skyDrawHeight);
        ctx.save();
        ctx.translate(this.skyTilePeriod, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(src, 0, 0, tileW, this.skyDrawHeight);
        ctx.restore();

        this.skySeamlessCanvas = c;
      }

      // Inicializa banco de nubes en 3 planos de profundidad parallax sobre el horizonte
      this.cloudEntities = [];
      const cloudSprites = assets.clouds || [];
      if (cloudSprites.length > 0) {
        const count = 14;
        for (let i = 0; i < count; i++) {
          const depthBand = i % 3; // 0 = lejana baja, 1 = media, 2 = alta cercana
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

    update(dt, _camera, _flight) {
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

      // Color cenital superior (extiende la parte alta del cielo durante alabeos pronunciados)
      worldCtx.fillStyle = "#1f4c7d";
      worldCtx.fillRect(0, 0, WORLD_W, horizonY + 2);

      // 1. Panorama crepuscular con horizonte de islas
      if (this.skySeamlessCanvas) {
        const period = this.skyTilePeriod;
        let scrollX = Math.round(camera.heading * 340) % period;
        if (scrollX < 0) scrollX += period;

        const drawY = horizonY - this.skyDrawHeight + 1;
        for (let x = -scrollX - period; x < WORLD_W + period; x += period) {
          worldCtx.drawImage(this.skySeamlessCanvas, x | 0, drawY | 0);
        }
      }

      // 2. Nubes dinámicas con parallax diferencial
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
  // [20] LAYER_OCEAN — SCANLINES UV EN PERSPECTIVA 1/Z + OLAS SUPER SCALER
  // ==========================================================================
  const LAYER_OCEAN = {
    name: "LAYER_OCEAN",
    zIndex: LAYER_Z_INDEX.LAYER_OCEAN,
    enabled: true,
    wavesEnabled: true,

    oceanData: null,
    waveAssets: null,

    // Buffer offscreen dedicado para scanlines por píxel a 60fps
    scanlineCanvas: null,
    scanlineCtx: null,
    scanlineImgData: null,
    scanlineBuf32: null,

    // Entidades activas de olas 3D sobre la superficie
    waveEntities: [],
    spawnAccumulator: 0,
    sprayAccumulator: 0,
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

      // Pre-poblar el océano desde el horizonte hasta primer plano desde el frame 0
      this.waveEntities = [];
      const initialCount = 68;
      for (let i = 0; i < initialCount; i++) {
        const t = i / initialCount;
        // Distribución más densa en lejanía/media distancia para cobertura visual uniforme
        const z = Z_CLIP_NEAR + 25 + Math.pow(t, 1.35) * (Z_HORIZON_FAR - 90);
        this._spawnWaveAtZ(z, 0, 1.0);
      }
    },

    /**
     * Actualiza en caliente la textura del océano y/o los frames si el usuario
     * arrastra una nueva hoja de sprites sobre la ventana.
     */
    hotSwapAssets(newOceanData, newFrames) {
      if (newOceanData) this.oceanData = newOceanData;
      if (newFrames && newFrames.length >= 4) {
        this.waveAssets.swellLoop = newFrames;
        this.waveAssets.breakerRight = newFrames;
        this.waveAssets.breakerLeft = newFrames;
      }
    },

    _spawnWaveAtZ(zPos, cameraX, speedMult) {
      const wAssets = this.waveAssets;
      if (!wAssets) return;

      // Corredor ancho en X para cubrir todo el campo visual incluso al alabear ±12°
      const corridorHalfWidth = 1350;
      const worldX =
        cameraX + (Math.random() * 2 - 1) * corridorHalfWidth;

      const roll = Math.random();
      let kind = "swell";
      let frames = wAssets.swellLoop;
      let worldWidth = 250 + Math.random() * 95;
      let fps = 9.0 + Math.random() * 2.5;
      let loop = true;

      if (roll < 0.44 && wAssets.swellLoop.length > 0) {
        // Tira ancha de ola en loop continuo (ola .. ola7)
        kind = "swell";
        frames = wAssets.swellLoop;
        worldWidth = 260 + Math.random() * 110;
        fps = 8.5 + Math.random() * 2.5;
      } else if (roll < 0.80 && wAssets.breakerRight.length > 0) {
        // Rompiente rizada (babor o estribor)
        kind = "breaker";
        frames =
          Math.random() < 0.5 ? wAssets.breakerRight : wAssets.breakerLeft;
        worldWidth = 105 + Math.random() * 48;
        fps = 8.0 + Math.random() * 3.0;
      } else if (wAssets.crestToSplashRight.length > 0) {
        // Cresta que estalla en salpicadura de espuma blanca
        kind = "crestSplash";
        frames =
          Math.random() < 0.5
            ? wAssets.crestToSplashRight
            : wAssets.crestToSplashLeft;
        worldWidth = 98 + Math.random() * 42;
        fps = 9.5 + speedMult * 1.5;
      }

      if (!frames || frames.length === 0) return;

      this.waveEntities.push({
        id: this.nextWaveId++,
        kind,
        frames,
        frameIndex: Math.random() * frames.length,
        fps,
        loop,
        x: worldX,
        y: 0,
        z: zPos, // Z relativa a la cámara (decrece hacia 0 al avanzar)
        worldWidth,
        lateralDrift: (Math.random() - 0.5) * 18,
      });
    },

    _spawnJetWashSpray(cameraX, speedMult) {
      const wAssets = this.waveAssets;
      if (!wAssets || wAssets.splashRight.length === 0) return;

      const side = Math.random() < 0.5 ? -1 : 1;
      const frames =
        side < 0 ? wAssets.splashLeft : wAssets.splashRight;

      this.waveEntities.push({
        id: this.nextWaveId++,
        kind: "spray",
        frames,
        frameIndex: 0,
        fps: 12 + speedMult * 3,
        loop: false,
        x: cameraX + side * (26 + Math.random() * 64),
        y: 0,
        z: 190 + Math.random() * 180,
        worldWidth: 56 + Math.random() * 28,
        lateralDrift: side * 38,
      });
    },

    update(dt, camera, flight, timeSec) {
      if (!this.enabled) return;

      const dz = camera.currentSpeed * dt;
      const speedMult = flight.speedMultiplier;

      // 1. Avanzar todas las olas existentes hacia la cámara (Z -> 0)
      for (let i = this.waveEntities.length - 1; i >= 0; i--) {
        const w = this.waveEntities[i];
        w.z -= dz;
        w.x += w.lateralDrift * dt;
        w.frameIndex += w.fps * (0.85 + speedMult * 0.22) * dt;

        if (w.loop) {
          if (w.frameIndex >= w.frames.length) {
            w.frameIndex %= w.frames.length;
          }
        } else if (w.frameIndex >= w.frames.length) {
          this.waveEntities.splice(i, 1);
          continue;
        }

        // Reciclar al salir por detrás/debajo de la cámara
        if (w.z <= Z_CLIP_NEAR) {
          this.waveEntities.splice(i, 1);
        }
      }

      // 2. Generación continua en el horizonte (aumenta proporcionalmente al acelerar Arriba/W)
      const baseSpawnPerSec = 19.5;
      const spawnRate = baseSpawnPerSec * Math.pow(speedMult, 1.18);
      this.spawnAccumulator += spawnRate * dt;

      const maxActiveWaves = 115;
      while (this.spawnAccumulator >= 1.0) {
        this.spawnAccumulator -= 1.0;
        if (this.waveEntities.length < maxActiveWaves) {
          const jitterZ = Z_HORIZON_FAR - 20 - Math.random() * 140;
          this._spawnWaveAtZ(jitterZ, camera.x, speedMult);
        }
      }

      // 3. Estela / espuma adicional a ras del agua al activar aceleración (Arriba / W)
      if (flight.throttle > 0.25) {
        this.sprayAccumulator += flight.throttle * 14.0 * dt;
        while (this.sprayAccumulator >= 1.0) {
          this.sprayAccumulator -= 1.0;
          if (this.waveEntities.length < maxActiveWaves) {
            this._spawnJetWashSpray(camera.x, speedMult);
          }
        }
      }

      this._lastTimeSec = timeSec;
    },

    /**
     * Renderiza la superficie del océano scanline por scanline con deformación UV
     * en perspectiva hiperbólica 1/Z:
     *  - Scanlines superiores (cerca del horizonte): comprimidas verticalmente,
     *    lentas y fundidas con la bruma cian/cobalto de `oceano.png`.
     *  - Scanlines inferiores: velocidad vertiginosa y apertura lateral en abanico.
     */
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

      // Escalas de densidad de textura calibradas al pixel art de `oceano.png`
      const U_SCALE = 1.48;
      const V_SCALE = 1.85;
      const camX = camera.x;
      const camZ = camera.z;

      let outIdx = 0;

      for (let dy = 0; dy < OCEAN_SCANLINES; dy++) {
        // Profundidad Z exacta para esta scanline
        const z = projK / (dy + dyBias);
        const invScale = z / FOCAL_LENGTH;

        // Oscilación H-Blank sutil de oleaje (estilo hardware arcade 16 bits)
        const swellWaveX =
          Math.sin(z * 0.045 - timeSec * 3.6) * (2.6 * Math.min(1, 280 / z));

        // Coordenada V de avance hacia adelante (comprimida arriba, vertiginosa abajo)
        const vCoord = ((camZ + z) * V_SCALE) | 0;
        const vRowOffset = (vCoord & maskV) << shiftV;

        // Coordenada U inicial en el extremo izquierdo y paso dU/dX en punto fijo 16.16
        const worldLeftX = camX - WORLD_CX * invScale + swellWaveX;
        let uFixed = (worldLeftX * U_SCALE * 65536.0) | 0;
        const stepUFixed = (invScale * U_SCALE * 65536.0) | 0;

        // Franja atmosférica del horizonte (primeras 48 scanlines)
        if (dy < 48) {
          const lutIdx = ((dy / 47) * lutMax) | 0;
          const hr = horizonLUT[lutIdx * 3];
          const hg = horizonLUT[lutIdx * 3 + 1];
          const hb = horizonLUT[lutIdx * 3 + 2];
          // Peso de atmósfera: 225/256 justo en el horizonte -> 0 en dy=48
          const fogWeight = (((48 - dy) * 225) / 48) | 0;
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
          // Bucle interno ultrarrápido en registro entero para medio y primer plano
          for (let px = 0; px < WORLD_W; px++) {
            const tu = (uFixed >> 16) & maskU;
            uFixed = (uFixed + stepUFixed) | 0;
            out32[outIdx++] = tex32[vRowOffset + tu];
          }
        }
      }

      this.scanlineCtx.putImageData(this.scanlineImgData, 0, 0);
      worldCtx.drawImage(this.scanlineCanvas, 0, HORIZON_WORLD_Y);

      // Brillo especular crepuscular sutil sobre la línea central del horizonte
      worldCtx.fillStyle = "rgba(155, 228, 255, 0.35)";
      worldCtx.fillRect(0, HORIZON_WORLD_Y, WORLD_W, 1);
    },

    /**
     * Renderiza todas las olas activas ordenadas de atrás hacia adelante (Painter's Algorithm)
     * con escalado Super Scaler nearest-neighbor hacia la cámara.
     */
    _renderDynamicWaves(worldCtx, camera) {
      if (!this.wavesEnabled || this.waveEntities.length === 0) return;

      // Ordenar de mayor Z (horizonte) a menor Z (cámara)
      this.waveEntities.sort((a, b) => b.z - a.z);

      for (let i = 0; i < this.waveEntities.length; i++) {
        const w = this.waveEntities[i];
        const proj = projectWorldPoint(w.x, w.y, w.z, camera);
        if (!proj) continue;

        const frame = w.frames[(w.frameIndex | 0) % w.frames.length];
        if (!frame) continue;

        const drawW = Math.max(2, Math.round(w.worldWidth * proj.scale));
        const aspect = frame.height / frame.width;
        const drawH = Math.max(1, Math.round(drawW * aspect));

        const drawX = Math.round(proj.screenX - drawW * 0.5);
        // Alinea la base de la ola sobre la coordenada proyectada del agua
        const drawY = Math.round(proj.screenY - drawH * 0.82);

        // Culling fuera del buffer de mundo
        if (
          drawX + drawW < 0 ||
          drawX > WORLD_W ||
          drawY + drawH < HORIZON_WORLD_Y ||
          drawY > WORLD_H
        ) {
          continue;
        }

        // Aparición progresiva suave justo al nacer en la línea del horizonte
        if (w.z > Z_HORIZON_FAR - 320) {
          worldCtx.globalAlpha = Math.max(
            0.15,
            (Z_HORIZON_FAR - w.z) / 320
          );
          worldCtx.drawImage(frame, drawX, drawY, drawW, drawH);
          worldCtx.globalAlpha = 1.0;
        } else {
          worldCtx.drawImage(frame, drawX, drawY, drawW, drawH);
        }
      }
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

    sprites: {},
    wakeFrames: [],
    /**
     * Arreglo desacoplado de unidades navales enemigas en espacio 3D simulado:
     * Cada contacto posee `{ id, designation, type, x, y, z, vx, vz, worldWidth, hp }`
     */
    ships: [],

    init(assets) {
      this.sprites.type42 = assets.enemies
        ? assets.enemies.type42Destroyer
        : null;
      this.wakeFrames =
        assets.waves && assets.waves.breakerRight
          ? assets.waves.breakerRight
          : [];

      // Flota inicial de prueba posicionada en coordenadas 3D sobre el horizonte
      this.ships = [
        {
          id: "D-80",
          designation: "TYPE-42 DESTROYER",
          type: "type42",
          x: -180,
          y: 0,
          z: 2350,
          vx: 14,
          vz: -45, // Navegando en patrulla; se acerca a velocidad del avión + rumbo
          worldWidth: 260,
          wakeAnim: 0,
          hp: 100,
        },
        {
          id: "F-88",
          designation: "TYPE-22 FRIGATE",
          type: "type42",
          x: 310,
          y: 0,
          z: 1580,
          vx: -11,
          vz: -35,
          worldWidth: 235,
          wakeAnim: 2.5,
          hp: 100,
        },
      ];
    },

    /**
     * Punto de extensión modular: permite inyectar nuevos sprites de fragatas/destructores
     * sin tocar la lógica de proyección 3D ni de ordenamiento Z.
     */
    registerEnemySprite(typeKey, spriteCanvasOrImage) {
      this.sprites[typeKey] = spriteCanvasOrImage;
    },

    update(dt, camera) {
      if (!this.enabled) return;
      const approachDz = camera.currentSpeed * dt;

      for (let i = 0; i < this.ships.length; i++) {
        const ship = this.ships[i];
        ship.z -= approachDz - ship.vz * dt;
        ship.x += ship.vx * dt;
        ship.wakeAnim = (ship.wakeAnim + 8 * dt) % 6;

        // Reubicar en patrulla lejana cuando el caza lo sobrevuela a ras del mástil
        if (ship.z < Z_CLIP_NEAR + 10) {
          ship.z = Z_HORIZON_FAR - 40 - Math.random() * 260;
          ship.x = camera.x + (Math.random() * 2 - 1) * 620;
        }
      }
    },

    render(worldCtx, camera) {
      if (!this.enabled || this.ships.length === 0) return;

      // Ordenar buques de más lejano a más cercano
      const sorted = this.ships.slice().sort((a, b) => b.z - a.z);

      for (let i = 0; i < sorted.length; i++) {
        const ship = sorted[i];
        const sprite = this.sprites[ship.type];
        if (!sprite) continue;

        const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
        if (!proj) continue;

        const drawW = Math.max(4, Math.round(ship.worldWidth * proj.scale));
        const drawH = Math.max(
          2,
          Math.round(drawW * (sprite.height / sprite.width))
        );
        const drawX = Math.round(proj.screenX - drawW * 0.5);
        const drawY = Math.round(proj.screenY - drawH * 0.9);

        if (drawX + drawW < 0 || drawX > WORLD_W) continue;

        // Sombra / reflejo oscuro del casco sobre el agua
        worldCtx.fillStyle = "rgba(4, 18, 38, 0.48)";
        worldCtx.fillRect(
          drawX + (drawW * 0.08) | 0,
          (proj.screenY - 1) | 0,
          (drawW * 0.84) | 0,
          Math.max(2, (drawH * 0.14) | 0)
        );

        // Buque escalado con nearest-neighbor puro
        if (ship.z > Z_HORIZON_FAR - 280) {
          worldCtx.globalAlpha = Math.max(0.25, (Z_HORIZON_FAR - ship.z) / 280);
          worldCtx.drawImage(sprite, drawX, drawY, drawW, drawH);
          worldCtx.globalAlpha = 1.0;
        } else {
          worldCtx.drawImage(sprite, drawX, drawY, drawW, drawH);
        }

        // Estela blanca de proa/popa sobre la línea de flotación
        if (this.wakeFrames.length > 0) {
          const wf =
            this.wakeFrames[(ship.wakeAnim | 0) % this.wakeFrames.length];
          const wakeW = Math.max(3, (drawW * 0.36) | 0);
          const wakeH = Math.max(2, (drawH * 0.28) | 0);
          worldCtx.drawImage(
            wf,
            (drawX - wakeW * 0.25) | 0,
            (proj.screenY - wakeH * 0.7) | 0,
            wakeW,
            wakeH
          );
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
      bobOffsetPx: 0,
      shudderX: 0,
      shudderY: 0,
    },

    init(assets) {
      this.aircraftSprites = assets.aircraft || {};
    },

    /**
     * Permite reemplazar o ampliar los sprites del caza (A-4 Skyhawk / Super Étendard).
     */
    setAircraftSprites(spriteMap) {
      Object.assign(this.aircraftSprites, spriteMap);
    },

    update(dt, _camera, flight, timeSec) {
      if (!this.enabled) return;
      const st = this.state;

      // Desplazamiento dinámico estilo After Burner II al alabear y acelerar
      const targetX = VIEW_W * 0.5 + flight.rollDeg * 3.4;
      const targetY =
        VIEW_H * 0.775 -
        Math.max(0, flight.throttle) * 8.0 +
        Math.sin(timeSec * 3.2) * 1.8;

      st.screenX += (targetX - st.screenX) * Math.min(1, 9 * dt);
      st.screenY += (targetY - st.screenY) * Math.min(1, 7 * dt);

      // Vibración aerodinámica de alta velocidad al activar postcombustión
      if (flight.throttle > 0.35) {
        const amp = (flight.throttle - 0.35) * 1.6;
        st.shudderX = (Math.random() * 2 - 1) * amp;
        st.shudderY = (Math.random() * 2 - 1) * amp;
      } else {
        st.shudderX = 0;
        st.shudderY = 0;
      }

      // Rotación del avión enlazada al alabeo de la cámara
      st.visualRollRad = flight.rollRad * 1.35;
    },

    _selectSpriteAndAngle(flight, timeSec) {
      const sp = this.aircraftSprites;

      // Maniobra evasiva de tonel (Espacio)
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

      // Alabeo pronunciado a Izquierda / Derecha usando los sprites dedicados en perspectiva
      if (flight.rollDeg <= -7.2 && sp.AVION2) {
        const extraRoll = ((flight.rollDeg + 7.2) * Math.PI) / 180;
        return { img: sp.AVION2, angleRad: extraRoll * 0.85, scale: 0.52 };
      }
      if (flight.rollDeg >= 7.2 && sp.AVION6) {
        const extraRoll = ((flight.rollDeg - 7.2) * Math.PI) / 180;
        return { img: sp.AVION6, angleRad: extraRoll * 0.85, scale: 0.52 };
      }

      // Vuelo nivelado / alabeo suave: alterna a postcombustión (`AVION.png`) al acelerar
      const useAfterburner =
        flight.throttle > 0.22 &&
        sp.AVION &&
        (flight.throttle > 0.55 || Math.sin(timeSec * 55) > -0.2);

      const baseImg = useAfterburner
        ? sp.AVION
        : sp.AVION1 || sp.AVION;

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

      // Sombra proyectada a baja cota sobre la espuma del océano
      screenCtx.save();
      screenCtx.translate(cx, VIEW_H - 18);
      screenCtx.scale(1.0, 0.22);
      screenCtx.fillStyle = "rgba(2, 10, 24, 0.42)";
      screenCtx.beginPath();
      screenCtx.arc(0, 0, 56, 0, Math.PI * 2);
      screenCtx.fill();
      screenCtx.restore();

      // Estelas blancas de condensación en punteras de ala al alabear o acelerar fuerte
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

      // Resplandor cálido adicional en tobera a máxima postcombustión
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

      // 1. Panel Izquierdo: VELOCIDAD (KTS) + BARRA DE EMPUJE + ALTÍMETRO RASANTE
      ctx.fillStyle = "rgba(5, 14, 26, 0.68)";
      ctx.fillRect(10, 10, 134, 52);
      ctx.strokeStyle = "rgba(77, 255, 145, 0.45)";
      ctx.strokeRect(10.5, 10.5, 133, 51);

      ctx.fillStyle = green;
      ctx.fillText("SPD  " + String(flight.knots).padStart(3, "0") + " KTS", 16, 15);

      const altStr = flight.altitudeMeters.toFixed(1).padStart(4, "0");
      ctx.fillStyle = flight.altitudeMeters < 9.5 ? amber : green;
      ctx.fillText("ALT  " + altStr + " M  RASANTE", 16, 28);

      // Barra de acelerador / postcombustión
      ctx.fillStyle = "#12293f";
      ctx.fillRect(16, 43, 84, 6);
      const normThr = Math.max(0.08, (flight.throttle + 0.55) / 1.55);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : green;
      ctx.fillRect(16, 43, Math.round(84 * normThr), 6);
      ctx.fillStyle = flight.throttle > 0.35 ? amber : cyan;
      ctx.fillText(flight.throttle > 0.35 ? "AB" : "MIL", 105, 41);

      // 2. Indicador Superior Central: RUMBO Y ÁNGULO DE ALABEO (-12° .. +12°)
      const rollTxt =
        (flight.rollDeg >= 0 ? "+" : "") + flight.rollDeg.toFixed(1) + "°";
      ctx.fillStyle = "rgba(5, 14, 26, 0.62)";
      ctx.fillRect(VIEW_W * 0.5 - 56, 10, 112, 18);
      ctx.fillStyle = cyan;
      ctx.textAlign = "center";
      ctx.fillText("BANK " + rollTxt, VIEW_W * 0.5, 14);

      // 3. Retícula Giroscópica Central + Escalera de Horizonte Artificial
      const pipX = Math.round(VIEW_W * 0.5 - flight.rollDeg * 1.6);
      const pipY = Math.round(HORIZON_SCREEN_Y + 26 - flight.throttle * 6);

      ctx.save();
      ctx.translate(pipX, pipY);
      ctx.rotate(-flight.rollRad);

      ctx.strokeStyle = "rgba(77, 255, 145, 0.82)";
      ctx.lineWidth = 1;
      // Barras laterales de horizonte artificial
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(-14, 0);
      ctx.moveTo(14, 0);
      ctx.lineTo(34, 0);
      ctx.stroke();

      // Anillo central del colimador de tiro
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = amber;
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();

      // Marcadores de enganche (Target Box) sobre buques enemigos visibles
      if (enemiesLayer && enemiesLayer.enabled) {
        ctx.strokeStyle = amber;
        ctx.fillStyle = amber;
        ctx.font = "bold 8px Consolas, monospace";
        for (let i = 0; i < enemiesLayer.ships.length; i++) {
          const ship = enemiesLayer.ships[i];
          if (ship.z > 1950 || ship.z < 90) continue;
          const proj = projectWorldPoint(ship.x, ship.y, ship.z, camera);
          if (!proj) continue;

          // Transformar del buffer de mundo rotado a pantalla
          const dx = proj.screenX - WORLD_CX;
          const dy = proj.screenY - HORIZON_WORLD_Y;
          const cosR = Math.cos(-camera.rollRad);
          const sinR = Math.sin(-camera.rollRad);
          const sx = VIEW_W * 0.5 + dx * cosR - dy * sinR;
          const sy = HORIZON_SCREEN_Y + dx * sinR + dy * cosR;

          if (sx > 24 && sx < VIEW_W - 24 && sy > 24 && sy < VIEW_H - 24) {
            const box = Math.max(10, Math.min(28, (180 * proj.scale) | 0));
            ctx.strokeRect(
              Math.round(sx - box * 0.5) + 0.5,
              Math.round(sy - box * 0.65) + 0.5,
              box,
              box
            );
            ctx.fillText(
              ship.id + " " + Math.round(ship.z) + "M",
              sx,
              sy - box * 0.65 - 10
            );
          }
        }
      }

      // 4. Radar Táctico Naval (Esquina Superior Derecha)
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

      // Cono de visión frontal + barrido de radar
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

      // Eco propio en la base del cono y contactos enemigos 3D
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

      // 5. Indicador táctil virtual cuando el jugador arrastra en móvil
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

