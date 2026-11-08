/**
 * ============================================================================
 * MALVINAS 1982 — PROCESADOR DE ASSETS & EXTRACTOR DE TEXTURAS PSEUDO-3D
 * ============================================================================
 * Responsabilidades (Requerimiento Técnico #1):
 *  1. Remoción inteligente de fondo blanco (#FFFFFF) mediante Flood-Fill desde
 *     bordes + cuantización alfa de 16 bits (preservando la espuma blanca #FFFFFF
 *     encerrada dentro de las crestas de las olas y la escarapela del avión).
 *  2. Esculpido orgánico de faldas de olas (`sculptWaveSprite`): elimina los
 *     cortes horizontales duros en la base azul de `ola`..`ola11` y perfila los
 *     extremos laterales de las tiras anchas para fundirlas sin costuras sobre
 *     el océano manteniendo 100% nítida la cresta y espuma pixel-art.
 *  3. Desenrollado (UV Unwrap) de alta definición (1024x256 toroidal sin costura
 *     de espejo central) a partir del trapezoide en perspectiva `oceano.png`.
 * ============================================================================
 */
(function (global) {
  "use strict";

  const Malvinas = (global.Malvinas = global.Malvinas || {});

  /**
   * Matriz Bayer 4x4 para costuras toroidales pixel-art (preserva paleta exacta
   * sin inventar colores borrosos en el wrap de la textura del mar).
   */
  const BAYER_4X4 = [
    [0 / 16, 8 / 16, 2 / 16, 10 / 16],
    [12 / 16, 4 / 16, 14 / 16, 6 / 16],
    [3 / 16, 11 / 16, 1 / 16, 9 / 16],
    [15 / 16, 7 / 16, 13 / 16, 5 / 16],
  ];

  /**
   * Tabla explícita de coordenadas de recorte (sx, sy, sw, sh) medida sobre los
   * assets originales en pixel art.
   */
  const SPRITE_COORDINATES = {
    // Cielo: recorta márgenes laterales para evitar línea vertical de 1px al espejar y corta en el horizonte
    cielo: { sx: 3, sy: 0, sw: 1438, sh: 430 },

    // Base trapezoidal en perspectiva del mar (superficie del océano)
    oceano: { sx: 15, sy: 36, sw: 1476, sh: 194 },

    // Tira continua de olas anchas (8 frames en loop continuo)
    waveSwellFrames: [
      { key: "ola", sx: 0, sy: 38, sw: 367, sh: 96 },
      { key: "ola1", sx: 0, sy: 25, sw: 365, sh: 136 },
      { key: "ola2", sx: 0, sy: 20, sw: 363, sh: 154 },
      { key: "ola3", sx: 0, sy: 22, sw: 359, sh: 173 },
      { key: "ola4", sx: 0, sy: 20, sw: 363, sh: 162 },
      { key: "ola5", sx: 0, sy: 7, sw: 361, sh: 171 },
      { key: "ola6", sx: 0, sy: 44, sw: 361, sh: 126 },
      { key: "ola7", sx: 0, sy: 53, sw: 365, sh: 94 },
    ],

    // Rompientes de cresta rizada (recorta los últimos 4px inferiores de borde oscuro)
    waveBreakerFrames: [
      { key: "ola8", sx: 11, sy: 7, sw: 163, sh: 99 },
      { key: "ola9", sx: 12, sy: 5, sw: 162, sh: 103 },
      { key: "ola10", sx: 5, sy: 19, sw: 161, sh: 69 },
      { key: "ola11", sx: 2, sy: 18, sw: 159, sh: 65 },
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

    // Sprites del avión caza
    aircraftKeys: [
      "AVION",
      "AVION1",
      "AVION2",
      "AVION3",
      "AVION4",
      "AVION5",
      "AVION6",
    ],

    // Buques navales (HMS Sheffield D80, fragatas y vistas lejanas / ángulo)
    shipKeys: [
      "barcolejos",
      "barco",
      "barco1",
      "barco2",
      "barco4",
      "barco5",
      "barco6",
      "barco7",
      "barco8",
      "barco9",
      "barco10",
    ],

    // Secuencia de impacto, explosión y hundimiento
    explosionKeys: [
      "barcoexplota",
      "barcoexplota1",
      "barcoexplota2",
      "barcoexplota3",
      "barcoexplota4",
      "barcoexplota5",
      "barcoexplota6",
      "barcoexplota7",
      "barcoexplota9",
    ],
  };

  function createCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, w | 0);
    c.height = Math.max(1, h | 0);
    return c;
  }

  /**
   * Carga un PNG desde `./Assets/<key>.png` en HTTP o desde `MALVINAS_ASSETS_MANIFEST`
   * en `file://` para permitir `getImageData()` sin bloqueo CORS.
   */
  function loadRawImage(key) {
    const manifest = global.MALVINAS_ASSETS_MANIFEST || {};
    const isFileProtocol =
      global.location && global.location.protocol === "file:";

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
   * Remueve el fondo blanco (#FFFFFF y halos exteriores) preservando la espuma
   * blanca encerrada dentro del contorno azul oscuro de las olas.
   */
  function removeWhiteBackground(imageData, options) {
    const opts = options || {};
    const whiteThreshold =
      opts.whiteThreshold !== undefined ? opts.whiteThreshold : 245;
    const maxChromaDiff =
      opts.maxChromaDiff !== undefined ? opts.maxChromaDiff : 14;
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

    for (let i = 0; i < total; i++) {
      const p = i * 4;
      const a = data[p + 3];
      if (a === 0) continue;
      if (
        a < 210 &&
        data[p] > 232 &&
        data[p + 1] > 232 &&
        data[p + 2] > 232
      ) {
        data[p + 3] = 0;
      } else if (opts.preserveSoftAlpha) {
        if (a < 135) data[p + 3] = 0;
      } else {
        data[p + 3] = a < alphaSnap ? 0 : 255;
      }
    }

    return imageData;
  }

  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  /**
   * Esculpe la base y flancos de cada sprite de ola (`swell`, `breaker`, `splash`):
   *  - Suaviza los trazos de contorno casi negros hacia azul cobalto marino para que
   *    las olas no muestren bordes negros ni rayas oscuras en la lejanía.
   *  - Elimina por completo el corte recto horizontal en la base inferior llevando
   *    alfa -> 0 de forma progresiva antes del borde inferior en todas las columnas.
   */
  function sculptWaveSprite(imageData, waveMode) {
    const d = imageData.data;
    const w = imageData.width;
    const h = imageData.height;

    const SEA_R = 8;
    const SEA_G = 132;
    const SEA_B = 212;

    for (let x = 0; x < w; x++) {
      let topY = -1;
      let botY = -1;
      for (let y = 0; y < h; y++) {
        if (d[(y * w + x) * 4 + 3] > 0) {
          if (topY === -1) topY = y;
          botY = y;
        }
      }
      if (topY === -1 || botY <= topY) continue;

      const normX = w > 1 ? x / (w - 1) : 0.5;
      const edgeDist = Math.min(normX, 1.0 - normX);

      let hFade = 1.0;
      let spanScale = 1.0;
      if (waveMode === "swell") {
        hFade = smoothstep(0.0, 0.24, edgeDist);
        spanScale = 0.34 + 0.66 * smoothstep(0.0, 0.3, edgeDist);
      } else if (waveMode === "breaker") {
        hFade = smoothstep(0.0, 0.08, edgeDist);
      }

      const rawSpan = botY - topY + 1;
      const activeSpan = Math.max(3, rawSpan * spanScale);

      for (let y = topY; y <= botY; y++) {
        const p = (y * w + x) * 4;
        if (d[p + 3] === 0) continue;

        let r = d[p];
        let g = d[p + 1];
        let b = d[p + 2];

        // Integrar contornos muy oscuros/negros al azul cobalto del Atlántico Sur
        if (r < 36 && g < 92 && b < 175) {
          r = Math.max(r, 6);
          g = Math.max(g, 102);
          b = Math.max(b, 194);
          d[p] = r;
          d[p + 1] = g;
          d[p + 2] = b;
        }

        const isFoam =
          (r > 135 && g > 205 && b > 230) || (g > 170 && b > 222);

        const relY = (y - topY) / activeSpan;
        const bottomPx = botY - y;
        let vFade = 1.0;

        if (waveMode === "swell") {
          const startFade = isFoam ? 0.48 : 0.26;
          if (relY > startFade) {
            vFade = 1.0 - smoothstep(startFade, 0.88, relY);
          }
          if (bottomPx < 6) {
            vFade *= smoothstep(0, 6, bottomPx);
          }
        } else if (waveMode === "breaker") {
          const startFade = isFoam ? 0.58 : 0.38;
          if (relY > startFade) {
            vFade = 1.0 - smoothstep(startFade, 0.88, relY);
          }
          // Garantiza alfa = 0 estricto en las filas inferiores incluso en las colas finas
          if (bottomPx < 7) {
            vFade *= smoothstep(0, 7, bottomPx);
          }
        } else if (waveMode === "splash") {
          if (h - 1 - y < 14 && !isFoam) {
            vFade = smoothstep(0, 14, h - 1 - y);
          }
        }

        const finalAlpha = Math.round(255 * hFade * vFade);
        if (finalAlpha < 10) {
          d[p + 3] = 0;
        } else {
          if (!isFoam && vFade < 0.9) {
            const tint = (1.0 - vFade) * 0.72;
            d[p] = Math.round(r * (1 - tint) + SEA_R * tint);
            d[p + 1] = Math.round(g * (1 - tint) + SEA_G * tint);
            d[p + 2] = Math.round(b * (1 - tint) + SEA_B * tint);
          }
          d[p + 3] = finalAlpha;
        }
      }
    }
  }

  /**
   * Extrae una subregión por coordenadas, limpia el fondo blanco (#FFFFFF) y
   * opcionalmente esculpe el contorno orgánico de ola o recorta bordes vacíos.
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
      return canvas;
    }

    if (!opts.skipChromaKey) {
      removeWhiteBackground(imgData, opts);
    }

    if (opts.waveMode) {
      sculptWaveSprite(imgData, opts.waveMode);
    }

    // Auto-trim de márgenes transparentes para alinear la base exacta de cada ola
    if (opts.autoTrim) {
      const d = imgData.data;
      let minX = sw,
        minY = sh,
        maxX = -1,
        maxY = -1;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          if (d[(y * sw + x) * 4 + 3] > 10) {
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

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

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
   * Desenrolla (UV Unwrap) el trapezoide en perspectiva de `oceano.png` a una
   * textura de alta resolución `1024 x 256` con costura toroidal Bayer (sin espejo
   * simétrico central, conservando el 100% de nitidez pixel-art en primer plano).
   */
  function buildOceanSurfaceData(oceanImg, rect) {
    const cleanTrap = extractCleanSprite(oceanImg, rect);
    const w = cleanTrap.width;
    const h = cleanTrap.height;
    const ctx = cleanTrap.getContext("2d", { willReadFrequently: true });
    const srcData = ctx.getImageData(0, 0, w, h).data;

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
        rowSpans.push({
          y: y,
          lx: lx + 6,
          rx: rx - 6,
        });
      }
    }

    if (rowSpans.length === 0) {
      for (let y = 0; y < h; y++) {
        rowSpans.push({ y: y, lx: 0, rx: Math.max(1, w - 1) });
      }
    }

    // 1. LUT atmosférica del horizonte (franja superior del trapezoide)
    const LUT_SIZE = 64;
    const horizonLUT = new Uint8Array(LUT_SIZE * 3);
    const horizonSpanCount = Math.min(
      38,
      Math.max(8, (rowSpans.length * 0.22) | 0)
    );
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

    // 2. Textura 1024x256 directa con costura toroidal Bayer de 96px en U y 40px en V
    //    (elimina por completo la línea de simetría central y cuadruplica el detalle)
    const TEX_W = 1024;
    const TEX_H = 256;
    const BLEND_U = 96;
    const BLEND_V = 40;

    const texBuffer = new ArrayBuffer(TEX_W * TEX_H * 4);
    const texBytes = new Uint8ClampedArray(texBuffer);
    const tex32 = new Uint32Array(texBuffer);

    const startRowIdx = Math.floor(rowSpans.length * 0.42);
    const endRowIdx = Math.max(startRowIdx + 8, rowSpans.length - 3);
    const bodyCount = endRowIdx - startRowIdx + 1;

    function sampleTrapezoid(normU, normV) {
      const rIdx =
        startRowIdx + Math.min(bodyCount - 1, Math.max(0, (normV * bodyCount) | 0));
      const span = rowSpans[rIdx];
      const spanW = span.rx - span.lx;
      const sx =
        span.lx + Math.min(spanW, Math.max(0, (normU * spanW) | 0));
      return (span.y * w + sx) * 4;
    }

    for (let tv = 0; tv < TEX_H; tv++) {
      // Coordenada V principal en [0 .. 0.84] con reserva [0.84 .. 1.0] para wrap toroidal
      const uScale = 0.86;
      const vScale = 0.84;
      const baseNormV = (tv / TEX_H) * vScale;

      for (let tu = 0; tu < TEX_W; tu++) {
        const baseNormU = (tu / TEX_W) * uScale;
        const bayer = BAYER_4X4[(tv >> 1) & 3][(tu >> 1) & 3];

        // Costura horizontal sin espejo: en los últimos BLEND_U píxeles enlaza con el borde derecho
        let useWrapU = false;
        if (tu >= TEX_W - BLEND_U) {
          const tU = (tu - (TEX_W - BLEND_U)) / BLEND_U;
          useWrapU = tU > bayer;
        }
        const finalU = useWrapU
          ? uScale + ((tu - (TEX_W - BLEND_U)) / BLEND_U) * (1.0 - uScale)
          : baseNormU + (1.0 - uScale);

        // Costura vertical sin espejo
        let useWrapV = false;
        if (tv >= TEX_H - BLEND_V) {
          const tV = (tv - (TEX_H - BLEND_V)) / BLEND_V;
          useWrapV = tV > bayer;
        }
        const finalV = useWrapV
          ? ((tv - (TEX_H - BLEND_V)) / BLEND_V) * (1.0 - vScale)
          : baseNormV + (1.0 - vScale);

        const sp = sampleTrapezoid(finalU, finalV);
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
      texShiftV: 10, // 2^10 = 1024
      tex32: tex32,
      horizonLUT: horizonLUT,
      horizonLUTSize: LUT_SIZE,
    };
  }

  function createPlaceholderDestroyerSprite() {
    const c = createCanvas(160, 64);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;

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

    ctx.fillStyle = "#495d73";
    ctx.fillRect(46, 30, 58, 13);
    ctx.fillStyle = "#677f99";
    ctx.fillRect(52, 23, 24, 8);
    ctx.fillRect(84, 26, 14, 6);

    ctx.fillStyle = "#dce9f5";
    ctx.fillRect(57, 17, 7, 6);
    ctx.fillRect(90, 20, 6, 6);

    ctx.fillStyle = "#1a2430";
    ctx.fillRect(68, 8, 3, 16);
    ctx.fillRect(64, 11, 11, 2);
    ctx.fillRect(80, 15, 6, 11);

    ctx.fillStyle = "#d9f7ff";
    ctx.fillRect(14, 57, 130, 2);
    ctx.fillStyle = "#7bd9ff";
    ctx.fillRect(20, 59, 118, 2);

    return c;
  }

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

    const topBand = bands[0];
    const oceanData = buildOceanSurfaceData(c, {
      sx: 0,
      sy: topBand.y0,
      sw: w,
      sh: topBand.y1 - topBand.y0 + 1,
    });

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
                {
                  skipChromaKey: true,
                  waveMode: bw > bh * 1.6 ? "swell" : "breaker",
                  autoTrim: true,
                }
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

  async function loadAllAssets(onProgress) {
    const keysToLoad = [
      "cielo",
      "oceano",
      ...SPRITE_COORDINATES.waveSwellFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.waveBreakerFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.waveSplashFrames.map((f) => f.key),
      ...SPRITE_COORDINATES.cloudKeys,
      ...SPRITE_COORDINATES.aircraftKeys,
      ...SPRITE_COORDINATES.shipKeys,
      ...SPRITE_COORDINATES.explosionKeys,
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

    const skyCanvas = rawImages.cielo
      ? extractCleanSprite(rawImages.cielo, SPRITE_COORDINATES.cielo, {
          skipChromaKey: true,
        })
      : null;

    const oceanSurface = buildOceanSurfaceData(
      rawImages.oceano,
      SPRITE_COORDINATES.oceano
    );

    // Olas anchas en loop continuo (`ola` .. `ola7`) con esculpido orgánico de falda
    const swellFrames = SPRITE_COORDINATES.waveSwellFrames
      .filter((item) => rawImages[item.key])
      .map((item) =>
        extractCleanSprite(rawImages[item.key], item, {
          waveMode: "swell",
          autoTrim: true,
        })
      );

    // Subconjunto de oleaje suave (para media-larga distancia y nacimiento de ola)
    const gentleSwellFrames =
      swellFrames.length >= 8
        ? [swellFrames[0], swellFrames[7], swellFrames[6], swellFrames[1]]
        : swellFrames;

    // Rompientes (`ola8` .. `ola11`) sin corte recto inferior
    const breakerRightRaw = SPRITE_COORDINATES.waveBreakerFrames
      .filter((item) => rawImages[item.key])
      .map((item) =>
        extractCleanSprite(rawImages[item.key], item, {
          waveMode: "breaker",
          autoTrim: true,
        })
      );

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

    // Salpicaduras y espuma (`ola12` .. `ola14`)
    const splashFramesRight = SPRITE_COORDINATES.waveSplashFrames
      .filter((item) => rawImages[item.key])
      .map((item) =>
        extractCleanSprite(rawImages[item.key], item, {
          waveMode: "splash",
          autoTrim: true,
        })
      );
    const splashFramesLeft = splashFramesRight.map(flipCanvasHorizontal);

    const fullCrestToSplashRight = [...breakerRightRaw, ...splashFramesRight];
    const fullCrestToSplashLeft =
      fullCrestToSplashRight.map(flipCanvasHorizontal);

    const clouds = SPRITE_COORDINATES.cloudKeys
      .filter((k) => rawImages[k])
      .map((k) =>
        extractCleanSprite(rawImages[k], null, {
          autoTrim: true,
          preserveSoftAlpha: true,
        })
      );

    const aircraft = {};
    for (const k of SPRITE_COORDINATES.aircraftKeys) {
      if (rawImages[k]) {
        aircraft[k] = extractCleanSprite(rawImages[k], null, {
          autoTrim: true,
          whiteThreshold: 248,
        });
      }
    }

    // Buques navales (HMS Sheffield D80 y fragatas)
    const ships = {};
    const shipsFlipped = {};
    for (const k of SPRITE_COORDINATES.shipKeys) {
      if (rawImages[k]) {
        const clean = extractCleanSprite(rawImages[k], null, {
          autoTrim: true,
          skipChromaKey: true,
        });
        ships[k] = clean;
        shipsFlipped[k] = flipCanvasHorizontal(clean);
      }
    }

    // Secuencia de impacto, explosión y hundimiento
    const explosions = {};
    const explosionsFlipped = {};
    for (const k of SPRITE_COORDINATES.explosionKeys) {
      if (rawImages[k]) {
        const clean = extractCleanSprite(rawImages[k], null, {
          autoTrim: true,
          skipChromaKey: true,
        });
        explosions[k] = clean;
        explosionsFlipped[k] = flipCanvasHorizontal(clean);
      }
    }

    // Secuencia ordenada de hundimiento progresivo tras impacto
    const explosionSeqKeys = [
      "barcoexplota",
      "barcoexplota1",
      "barcoexplota2",
      "barcoexplota3",
      "barcoexplota4",
      "barcoexplota5",
      "barcoexplota6",
      "barcoexplota7",
      "barcoexplota9",
    ];
    const explosionSequence = explosionSeqKeys
      .map((k) => explosions[k])
      .filter(Boolean);
    const explosionSequenceFlipped = explosionSeqKeys
      .map((k) => explosionsFlipped[k])
      .filter(Boolean);

    // Tira de animación de estela/patrulla para buques cercanos
    const shipWakeCycle = [
      ships.barco4,
      ships.barco7,
      ships.barco8,
      ships.barco9,
      ships.barco10,
    ].filter(Boolean);
    const shipWakeCycleFlipped = [
      shipsFlipped.barco4,
      shipsFlipped.barco7,
      shipsFlipped.barco8,
      shipsFlipped.barco9,
      shipsFlipped.barco10,
    ].filter(Boolean);

    return {
      skyCanvas,
      ocean: oceanSurface,
      waves: {
        swellLoop: swellFrames,
        gentleSwell: gentleSwellFrames,
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
        type42Destroyer: ships.barco4 || ships.barco || createPlaceholderDestroyerSprite(),
        ships,
        shipsFlipped,
        explosions,
        explosionsFlipped,
        explosionSequence,
        explosionSequenceFlipped,
        shipWakeCycle,
        shipWakeCycleFlipped,
      },
    };
  }

  Malvinas.AssetProcessor = {
    SPRITE_COORDINATES,
    loadAllAssets,
    extractCleanSprite,
    removeWhiteBackground,
    sculptWaveSprite,
    buildOceanSurfaceData,
    extractFromCombinedSpritesheet,
  };
})(window);
