/**
 * ============================================================================
 * MALVINAS 1982 — PROCESADOR DE ASSETS & EXTRACTOR DE TEXTURAS PSEUDO-3D
 * ============================================================================
 * Responsabilidades (Requerimiento Técnico #1):
 *  1. Remoción inteligente de fondo blanco (#FFFFFF) mediante Flood-Fill desde
 *     bordes + cuantización alfa de 16 bits (preservando la espuma blanca #FFFFFF
 *     encerrada dentro de las crestas de las olas y la escarapela del avión).
 *  2. Extracción por coordenadas exactas de:
 *     - Base trapezoidal en perspectiva del océano (`oceano.png`) -> Desenrollado
 *       (UV Unwrapping) a textura seamless 512x256 Uint32Array + LUT de horizonte.
 *     - Tiras de animación de olas en loop continuo (`ola` .. `ola7`).
 *     - Rompientes (`ola8` .. `ola11`) y salpicaduras/espuma (`ola12` .. `ola14`).
 *     - Cielo con horizonte de islas (`cielo.png`), nubes parallax (`nube`..`nube9`)
 *       y sprites del caza (`AVION` .. `AVION6`).
 *  3. Soporte en vivo para arrastrar/soltar una hoja combinada (spritesheet única
 *     sobre fondo #FFFFFF) y extraer automáticamente el trapezoide superior y las
 *     tiras inferiores de olas.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  /**
   * Matriz Bayer 4x4 clásica de 16 bits para fundir los bordes inferiores y
   * laterales de las tiras anchas de olas (`ola`..`ola7`) sobre el mar sin usar
   * desenfoque moderno (mantiene estética pixel-art pura de Sega Super Scaler).
   */
  const BAYER_4X4 = [
    [0 / 16, 8 / 16, 2 / 16, 10 / 16],
    [12 / 16, 4 / 16, 14 / 16, 6 / 16],
    [3 / 16, 11 / 16, 1 / 16, 9 / 16],
    [15 / 16, 7 / 16, 13 / 16, 5 / 16],
  ];

  /**
   * Tabla explícita de coordenadas de recorte (sx, sy, sw, sh) medida sobre los
   * assets originales en pixel art para eliminar márgenes vacíos y alinear la
   * línea de flotación (waterline) de todos los cuadros de animación.
   */
  const SPRITE_COORDINATES = {
    // Cielo: recorta los 4px derechos vacíos y corta exactamente en la línea de horizonte (Y=432)
    cielo: { sx: 0, sy: 0, sw: 1445, sh: 432 },

    // Base trapezoidal en perspectiva del mar (superficie del océano)
    oceano: { sx: 15, sy: 36, sw: 1476, sh: 194 },

    // Tira continua de olas anchas (8 frames en loop continuo)
    waveSwellFrames: [
      { key: "ola", sx: 0, sy: 38, sw: 367, sh: 100 },
      { key: "ola1", sx: 0, sy: 25, sw: 365, sh: 140 },
      { key: "ola2", sx: 0, sy: 20, sw: 363, sh: 158 },
      { key: "ola3", sx: 0, sy: 22, sw: 359, sh: 178 },
      { key: "ola4", sx: 0, sy: 20, sw: 363, sh: 167 },
      { key: "ola5", sx: 0, sy: 7, sw: 361, sh: 176 },
      { key: "ola6", sx: 0, sy: 44, sw: 361, sh: 131 },
      { key: "ola7", sx: 0, sy: 53, sw: 365, sh: 98 },
    ],

    // Rompientes de cresta rizada (4 frames base -> loop de 6 pasos)
    waveBreakerFrames: [
      { key: "ola8", sx: 11, sy: 7, sw: 163, sh: 104 },
      { key: "ola9", sx: 12, sy: 5, sw: 162, sh: 108 },
      { key: "ola10", sx: 5, sy: 19, sw: 161, sh: 74 },
      { key: "ola11", sx: 0, sy: 18, sw: 163, sh: 70 },
    ],

    // Salpicaduras de espuma / spray de alta velocidad
    waveSplashFrames: [
      { key: "ola12", sx: 7, sy: 10, sw: 146, sh: 103 },
      { key: "ola13", sx: 10, sy: 4, sw: 151, sh: 109 },
      { key: "ola14", sx: 18, sy: 14, sw: 134, sh: 116 },
    ],

    // Nubes parallax sobre el Atlántico Sur
    cloudKeys: [
      "nube",
      "nube1",
      "nube2",
      "nube3",
      "nube4",
      "nube5",
      "nube6",
      "nube7",
      "nube8",
      "nube9",
    ],

    // Sprites del avión caza (crucero, postcombustión, alabeo y maniobra evasiva)
    aircraftKeys: [
      "AVION",
      "AVION1",
      "AVION2",
      "AVION3",
      "AVION4",
      "AVION5",
      "AVION6",
    ],
  };

  function createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  /**
   * Carga un PNG desde `./Assets/<key>.png` cuando corre en servidor HTTP, o usa
   * el manifiesto Base64 embebido cuando se abre vía `file://` para evitar que
   * el navegador bloquee `ctx.getImageData()` por política de canvas contaminado (CORS).
   */
  function loadRawImage(key) {
    const manifest = global.MALVINAS_ASSETS_MANIFEST || {};
    const isFileProtocol = global.location && global.location.protocol === "file:";

    function fromSrc(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        if (!src.startsWith("data:")) {
          img.crossOrigin = "anonymous";
        }
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = src;
      });
    }

    if (isFileProtocol && manifest[key]) {
      return fromSrc(manifest[key]);
    }

    return fromSrc("./Assets/" + key + ".png").catch(() => {
      if (manifest[key]) return fromSrc(manifest[key]);
      throw new Error("Asset no encontrado: " + key);
    });
  }

  /**
   * Remueve el fondo blanco (#FFFFFF y halos casi blancos conectados al exterior)
   * aplicando transparencia alfa real sin borrar la espuma blanca interior de las olas.
   */
  function removeWhiteBackground(imageData, options) {
    const opts = options || {};
    const whiteThreshold = opts.whiteThreshold !== undefined ? opts.whiteThreshold : 245;
    const maxChromaDiff = opts.maxChromaDiff !== undefined ? opts.maxChromaDiff : 14;
    const alphaSnap = opts.alphaSnap !== undefined ? opts.alphaSnap : 92;

    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const total = w * h;
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0;
    let tail = 0;

    function isExteriorWhiteOrTransparent(idx) {
      const p = idx * 4;
      const a = data[p + 3];
      if (a < 24) return true;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
        const hi = Math.max(r, g, b);
        const lo = Math.min(r, g, b);
        return hi - lo <= maxChromaDiff;
      }
      return false;
    }

    function enqueue(idx) {
      if (!visited[idx] && isExteriorWhiteOrTransparent(idx)) {
        visited[idx] = 1;
        queue[tail++] = idx;
      }
    }

    // Semillas en los 4 bordes y en cualquier píxel ya transparente del recorte
    for (let x = 0; x < w; x++) {
      enqueue(x);
      enqueue((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      enqueue(y * w);
      enqueue(y * w + (w - 1));
    }
    for (let i = 0; i < total; i++) {
      if (data[i * 4 + 3] < 16 && !visited[i]) {
        visited[i] = 1;
        queue[tail++] = i;
      }
    }

    // Flood-Fill 8-conectado hacia píxeles blancos externos (#FFFFFF)
    while (head < tail) {
      const curr = queue[head++];
      const p = curr * 4;
      data[p + 3] = 0;

      const cx = curr % w;
      const cy = (curr / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          if (nx < 0 || nx >= w) continue;
          enqueue(ny * w + nx);
        }
      }
    }

    // Cuantización alfa estilo arcade 16 bits: elimina halos semitransparentes blancos
    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const a = data[p + 3];
      if (a === 0) continue;
      if (a < alphaSnap) {
        data[p + 3] = 0;
      } else if (
        a < 210 &&
        data[p] > 235 &&
        data[p + 1] > 235 &&
        data[p + 2] > 235
      ) {
        data[p + 3] = 0;
      } else {
        data[p + 3] = 255;
      }
    }

    return imageData;
  }

  /**
   * Extrae una subregión por coordenadas, limpia el fondo blanco (#FFFFFF) y
   * opcionalmente aplica tramado Bayer 4x4 en la falda inferior/lateral (para tiras de olas).
   */
  function extractCleanSprite(img, rect, options) {
    const opts = options || {};
    const sx = rect ? rect.sx : 0;
    const sy = rect ? rect.sy : 0;
    const sw = rect ? rect.sw : img.width;
    const sh = rect ? rect.sh : img.height;

    const canvas = createCanvas(sw, sh);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, sw, sh);
    } catch (_securityErr) {
      // Fallback seguro si el usuario inyecta una imagen externa sin CORS
      return canvas;
    }

    if (!opts.skipChromaKey) {
      removeWhiteBackground(imgData, opts);
    }

    // Auto-trim opcional de bordes transparentes (nubes y avión)
    if (opts.autoTrim) {
      const d = imgData.data;
      let minX = sw,
        minY = sh,
        maxX = -1,
        maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (d[(y * sw + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX >= minX && maxY >= minY) {
        const tw = maxX - minX + 1;
        const th = maxY - minY + 1;
        const trimmed = createCanvas(tw, th);
        const tctx = trimmed.getContext("2d");
        tctx.putImageData(imgData, -minX, -minY);
        return trimmed;
      }
    }

    // Tramado Bayer 4x4 pixel-art para fundir faldas de tiras de olas anchas en el océano
    if (opts.ditherSkirt) {
      const d = imgData.data;
      const bottomFadePx = Math.max(8, (sh * 0.24) | 0);
      const sideFadePx = Math.max(12, (sw * 0.11) | 0);
      const pixelBlock = 2; // Escala de bloque de dither acorde al pixel art

      for (let y = 0; y < sh; y++) {
        const bottomDist = sh - 1 - y;
        const vFactor =
          bottomDist < bottomFadePx ? bottomDist / bottomFadePx : 1.0;

        for (let x = 0; x < sw; x++) {
          const p = (y * sw + x) * 4;
          if (d[p + 3] === 0) continue;

          const sideDist = Math.min(x, sw - 1 - x);
          const hFactor = sideDist < sideFadePx ? sideDist / sideFadePx : 1.0;
          const keepProb = vFactor * hFactor;

          if (keepProb < 0.999) {
            const threshold =
              BAYER_4X4[((y / pixelBlock) | 0) & 3][((x / pixelBlock) | 0) & 3];
            if (keepProb <= threshold) {
              d[p + 3] = 0;
            }
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Genera una copia espejada horizontalmente en pixel-art puro (para que las
   * rompientes ricen tanto a babor como a estribor).
   */
  function flipCanvasHorizontal(sourceCanvas) {
    const out = createCanvas(sourceCanvas.width, sourceCanvas.height);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.translate(out.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(sourceCanvas, 0, 0);
    return out;
  }

  /**
   * Desenrolla (UV Unwrap) el trapezoide en perspectiva de `oceano.png` para obtener:
   *  1. `tex32` (Uint32Array 512x256): Textura rectangular seamless en X e Y con los
   *     colores exactos del pixel art original, lista para el motor de scanlines 1/Z.
   *  2. `horizonLUT` (Uint8Array 64x3): Gradiente atmosférico cian->cobalto extraído
   *     de la franja superior del horizonte en `oceano.png`.
   */
  function buildOceanSurfaceData(oceanImg, rect) {
    const cleanTrap = extractCleanSprite(oceanImg, rect);
    const w = cleanTrap.width;
    const h = cleanTrap.height;
    const ctx = cleanTrap.getContext("2d", { willReadFrequently: true });
    const srcData = ctx.getImageData(0, 0, w, h).data;

    // 1. Escanear bordes izquierdo y derecho reales de cada fila del trapezoide
    const rowSpans = [];
    for (let y = 0; y < h; y++) {
      let lx = -1;
      let rx = -1;
      for (let x = 0; x < w; x++) {
        if (srcData[(y * w + x) * 4 + 3] > 200) {
          lx = x;
          break;
        }
      }
      for (let x = w - 1; x >= 0; x--) {
        if (srcData[(y * w + x) * 4 + 3] > 200) {
          rx = x;
          break;
        }
      }
      if (lx !== -1 && rx - lx > 64) {
        // Margen interior de 4px para descartar píxeles de borde diagonal
        rowSpans.push({
          y: y,
          lx: lx + 4,
          rx: rx - 4,
        });
      }
    }

    // Fallback defensivo si una imagen externa está vacía o bloqueada por CORS
    if (rowSpans.length === 0) {
      for (let y = 0; y < h; y++) {
        rowSpans.push({ y: y, lx: 0, rx: Math.max(1, w - 1) });
      }
    }

    // 2. Extraer LUT atmosférica del horizonte (primeras ~36 filas activas del trapezoide)
    const LUT_SIZE = 64;
    const horizonLUT = new Uint8Array(LUT_SIZE * 3);
    const horizonSpanCount = Math.min(38, Math.max(8, (rowSpans.length * 0.22) | 0));
    for (let i = 0; i < LUT_SIZE; i++) {
      const spanIdx = Math.min(
        rowSpans.length - 1,
        ((i / (LUT_SIZE - 1)) * horizonSpanCount) | 0
      );
      const span = rowSpans[spanIdx];
      const midX = ((span.lx + span.rx) * 0.5) | 0;
      const p = (span.y * w + midX) * 4;
      horizonLUT[i * 3] = srcData[p];
      horizonLUT[i * 3 + 1] = srcData[p + 1];
      horizonLUT[i * 3 + 2] = srcData[p + 2];
    }

    // 3. Construir mapa UV 512x256 (potencia de 2 para máscaras bit a bit ultrarrápidas)
    //    usando el cuerpo rico en ondas del trapezoide ( ~38%..98% de altura ) con
    //    wrapping espejo C0 en U y V para eliminar cualquier costura de tiling
    //    preservando el 100% de la paleta pixel-art exacta.
    const TEX_W = 512;
    const TEX_H = 256;
    const HALF_W = TEX_W >> 1;
    const HALF_H = TEX_H >> 1;

    const texBuffer = new ArrayBuffer(TEX_W * TEX_H * 4);
    const texBytes = new Uint8ClampedArray(texBuffer);
    const tex32 = new Uint32Array(texBuffer);

    const startRowIdx = Math.floor(rowSpans.length * 0.37);
    const endRowIdx = Math.max(startRowIdx + 8, rowSpans.length - 3);
    const bodyCount = endRowIdx - startRowIdx + 1;

    for (let tv = 0; tv < TEX_H; tv++) {
      // Espejo vertical suave: 0..127 avanza, 128..255 regresa sin salto de color
      const pingPongV = tv < HALF_H ? tv : TEX_H - 1 - tv;
      const normV = pingPongV / (HALF_H - 1);
      const span = rowSpans[startRowIdx + ((normV * (bodyCount - 1)) | 0)];
      const spanWidth = span.rx - span.lx;

      // Ligero desfase horizontal en la mitad espejada sólo con wrap continuo
      for (let tu = 0; tu < TEX_W; tu++) {
        const pingPongU = tu < HALF_W ? tu : TEX_W - 1 - tu;
        const normU = pingPongU / (HALF_W - 1);
        const sx = span.lx + ((normU * spanWidth) | 0);
        const sp = (span.y * w + sx) * 4;
        const dp = (tv * TEX_W + tu) * 4;

        texBytes[dp] = srcData[sp];
        texBytes[dp + 1] = srcData[sp + 1];
        texBytes[dp + 2] = srcData[sp + 2];
        texBytes[dp + 3] = 255;
      }
    }

    return {
      trapezoidCanvas: cleanTrap,
      texWidth: TEX_W,
      texHeight: TEX_H,
      texMaskU: TEX_W - 1,
      texMaskV: TEX_H - 1,
      texShiftV: 9, // 2^9 = 512
      tex32: tex32,
      horizonLUT: horizonLUT,
      horizonLUTSize: LUT_SIZE,
    };
  }

  /**
   * Generador procedural de buque destructor en pixel art 16 bits (placeholder
   * modular para `LAYER_ENEMIES` hasta que se incorporen los PNG definitivos de
   * fragatas Tipo 42 / Tipo 22).
   */
  function createPlaceholderDestroyerSprite() {
    const c = createCanvas(160, 64);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // Casco naval gris acero Atlántico Sur
    ctx.fillStyle = "#1c2838";
    ctx.beginPath();
    ctx.moveTo(10, 48);
    ctx.lineTo(152, 48);
    ctx.lineTo(140, 58);
    ctx.lineTo(22, 58);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#3c4f65";
    ctx.fillRect(18, 43, 126, 6);
    ctx.fillStyle = "#566e88";
    ctx.fillRect(18, 42, 68, 3);

    // Superestructura puente + domo radar Tipo 42 (HMS Sheffield / Coventry silhouette)
    ctx.fillStyle = "#495d73";
    ctx.fillRect(46, 30, 58, 13);
    ctx.fillStyle = "#677f99";
    ctx.fillRect(52, 23, 24, 8);
    ctx.fillRect(84, 26, 14, 6);

    // Domos blancos radar Sea Dart y mástil principal
    ctx.fillStyle = "#dce9f5";
    ctx.fillRect(57, 17, 7, 6);
    ctx.fillRect(90, 20, 6, 6);

    ctx.fillStyle = "#1a2430";
    ctx.fillRect(68, 8, 3, 16);
    ctx.fillRect(64, 11, 11, 2);
    ctx.fillRect(80, 15, 6, 11); // Chimenea oscura

    // Línea de espuma blanca en la flotación del casco
    ctx.fillStyle = "#d9f7ff";
    ctx.fillRect(14, 57, 130, 2);
    ctx.fillStyle = "#7bd9ff";
    ctx.fillRect(20, 59, 118, 2);

    return c;
  }

  /**
   * Extractor en caliente desde una única hoja de sprites combinada con fondo blanco
   * (#FFFFFF): detecta automáticamente la banda superior (trapezoide del océano) y
   * las filas inferiores de frames de olas mediante proyección de filas/columnas.
   */
  function extractFromCombinedSpritesheet(sheetImg) {
    const w = sheetImg.width;
    const h = sheetImg.height;
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(sheetImg, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    removeWhiteBackground(imgData, { whiteThreshold: 244, alphaSnap: 88 });
    ctx.putImageData(imgData, 0, 0);

    const d = imgData.data;
    const rowCounts = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let count = 0;
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 0) count++;
      }
      rowCounts[y] = count;
    }

    // Encontrar bandas horizontales separadas por filas vacías
    const bands = [];
    let inBand = false;
    let startY = 0;
    for (let y = 0; y < h; y++) {
      if (rowCounts[y] > 6 && !inBand) {
        inBand = true;
        startY = y;
      } else if (rowCounts[y] <= 6 && inBand) {
        inBand = false;
        if (y - startY >= 16) bands.push({ y0: startY, y1: y - 1 });
      }
    }
    if (inBand && h - startY >= 16) bands.push({ y0: startY, y1: h - 1 });
    if (bands.length === 0) return null;

    // Primera banda superior = Trapezoide base del océano
    const topBand = bands[0];
    const oceanData = buildOceanSurfaceData(c, {
      sx: 0,
      sy: topBand.y0,
      sw: w,
      sh: topBand.y1 - topBand.y0 + 1,
    });

    // Bandas inferiores = Tiras de cuadros de olas, rompientes y espuma
    const extractedFrames = [];
    for (let b = 1; b < bands.length; b++) {
      const band = bands[b];
      const bh = band.y1 - band.y0 + 1;
      let inCol = false;
      let startX = 0;

      for (let x = 0; x <= w; x++) {
        let colAlpha = 0;
        if (x < w) {
          for (let y = band.y0; y <= band.y1; y++) {
            if (d[(y * w + x) * 4 + 3] > 0) colAlpha++;
          }
        }
        if (colAlpha > 2 && !inCol) {
          inCol = true;
          startX = x;
        } else if ((colAlpha <= 2 || x === w) && inCol) {
          inCol = false;
          const bw = x - startX;
          if (bw >= 18) {
            extractedFrames.push(
              extractCleanSprite(
                c,
                { sx: startX, sy: band.y0, sw: bw, sh: bh },
                { skipChromaKey: true, ditherSkirt: bw > bh * 1.6 }
              )
            );
          }
        }
      }
    }

    return {
      ocean: oceanData,
      frames: extractedFrames,
    };
  }

  /**
   * Carga y procesa todo el banco de assets del prototipo reportando progreso.
   */
  async function loadAllAssets(onProgress) {
    const keysToLoad = [
      "cielo",
      "oceano",
      ...SPRITE_COORDINATES.waveSwellFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.waveBreakerFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.waveSplashFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.cloudKeys,
      ...SPRITE_COORDINATES.aircraftKeys,
    ];

    const rawImages = {};
    let loaded = 0;

    await Promise.all(
      keysToLoad.map(async (key) => {
        try {
          rawImages[key] = await loadRawImage(key);
        } catch (err) {
          console.warn("[AssetProcessor] Asset opcional ausente:", key, err);
        } finally {
          loaded++;
          if (onProgress) onProgress(loaded / keysToLoad.length);
        }
      })
    );

    // 1. Cielo con islas en el horizonte (sin transparencia interior)
    const skyCanvas = rawImages.cielo
      ? extractCleanSprite(rawImages.cielo, SPRITE_COORDINATES.cielo, {
          skipChromaKey: true,
        })
      : null;

    // 2. Océano trapezoidal -> Desenrollado UV 512x256 + LUT de horizonte
    const oceanSurface = buildOceanSurfaceData(
      rawImages.oceano,
      SPRITE_COORDINATES.oceano
    );

    // 3. Tira de animación de olas anchas en loop continuo (8 frames con falda Bayer)
    const swellFrames = SPRITE_COORDINATES.waveSwellFrames
      .filter((item) => rawImages[item.key])
      .map((item) =>
        extractCleanSprite(rawImages[item.key], item, {
          ditherSkirt: true,
        })
      );

    // 4. Rompientes (derecha + espejadas izquierda, loop suave de 6 cuadros)
    const breakerRightRaw = SPRITE_COORDINATES.waveBreakerFrames
      .filter((item) => rawImages[item.key])
      .map((item) => extractCleanSprite(rawImages[item.key], item));

    const breakerLoopRight =
      breakerRightRaw.length >= 4
        ? [
            breakerRightRaw[0],
            breakerRightRaw[1],
            breakerRightRaw[2],
            breakerRightRaw[3],
            breakerRightRaw[2],
            breakerRightRaw[1],
          ]
        : breakerRightRaw;

    const breakerLoopLeft = breakerLoopRight.map(flipCanvasHorizontal);

    // 5. Salpicaduras y espuma de alta velocidad
    const splashFramesRight = SPRITE_COORDINATES.waveSplashFrames
      .filter((item) => rawImages[item.key])
      .map((item) => extractCleanSprite(rawImages[item.key], item));
    const splashFramesLeft = splashFramesRight.map(flipCanvasHorizontal);

    // Secuencia completa rompiente -> explosión de espuma (7 cuadros)
    const fullCrestToSplashRight = [...breakerRightRaw, ...splashFramesRight];
    const fullCrestToSplashLeft = fullCrestToSplashRight.map(flipCanvasHorizontal);

    // 6. Nubes parallax limpias de halos #FFFFFF
    const clouds = SPRITE_COORDINATES.cloudKeys
      .filter((k) => rawImages[k])
      .map((k) => extractCleanSprite(rawImages[k], null, { autoTrim: true }));

    // 7. Caza argentino en primer plano (`LAYER_PLAYER`)
    const aircraft = {};
    for (const k of SPRITE_COORDINATES.aircraftKeys) {
      if (rawImages[k]) {
        aircraft[k] = extractCleanSprite(rawImages[k], null, {
          autoTrim: true,
          whiteThreshold: 248,
        });
      }
    }

    return {
      skyCanvas,
      ocean: oceanSurface,
      waves: {
        swellLoop: swellFrames,
        breakerRight: breakerLoopRight,
        breakerLeft: breakerLoopLeft,
        splashRight: splashFramesRight,
        splashLeft: splashFramesLeft,
        crestToSplashRight: fullCrestToSplashRight,
        crestToSplashLeft: fullCrestToSplashLeft,
      },
      clouds,
      aircraft,
      enemies: {
        type42Destroyer: createPlaceholderDestroyerSprite(),
      },
    };
  }

  Malvinas.AssetProcessor = {
    SPRITE_COORDINATES,
    loadAllAssets,
    extractCleanSprite,
    removeWhiteBackground,
    buildOceanSurfaceData,
    extractFromCombinedSpritesheet,
  };
})(window);
