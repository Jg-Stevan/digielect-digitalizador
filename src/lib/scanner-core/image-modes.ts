/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * image-modes.ts — Funciones PURAS de filtros del motor.
 *
 * ERROR #7 del catálogo (§14): el fallback canvas PROHIBIDO implementar otra
 * matemática (Otsu global, estiramientos ad-hoc). Este módulo es el puerto
 * EXACTO de las funciones del DetectionWorker (src/scanner/workers/
 * enhanceJs.ts → bundle public/scanner/detection-worker.js): worker y
 * fallback comparten las MISMAS funciones con las MISMAS constantes.
 *
 * Todo opera sobre Uint8ClampedArray/TypedArrays — sin DOM, sin OpenCV.
 */

// ─── Constantes congeladas (§8 del SPEC-MAESTRO — R-05) ─────────────────────

/** Percentil → blanco puro (Texto claro) — F-TEXT-CLEAN: 0.95 estira con
 *  suavidad (el 0.85 amplificaba el ruido residual y moteaba el papel). */
export const TEXT_CLARO_WHITE_PCT = 0.95;
/** Exponente de tinta (Texto claro) — F-TEXT-CLEAN: contraste controlado
 *  sin el corte agresivo de la S-curve 1.8 (textura moteada). */
export const TEXT_CLARO_CONTRAST = 1.45;
/** Pivote papel/tinta (Texto claro) — F-TEXT-CLEAN: frontera de la región
 *  smoothstep (papel) y de la curva de tinta. */
export const TEXT_CLARO_PIVOT = 0.82;
/** Piso de tinta (Texto claro) — F-TEXT-CLEAN: rodilla cuadrática suave
 *  (inkVal²/bp) en vez del corte lineal 0.2. */
export const TEXT_CLARO_BLACK_POINT = 0.15;

/** Ventana Bradley-Roth = fracción del ANCHO. */
export const BW_WINDOW_RATIO = 1 / 12;
/** Negro si v ≤ m·(1−T). */
export const BW_T = 0.15;
export const BW_SAUVOLA_K = 0.34;
export const BW_SAUVOLA_R = 128;
/** Componentes de tinta < 3 px fuera. */
export const BW_DESPECKLE_PX = 3;

/** Mapa de sombra reducido. */
export const ILLUM_MAP_LONG_SIDE = 800;
/** Kernel del close morfológico: odd(max(3, floor(800/32))) ≈ 25. */
export const ILLUM_KERNEL =
  Math.max(3, Math.floor(ILLUM_MAP_LONG_SIDE / 32)) % 2 === 0
    ? Math.max(3, Math.floor(ILLUM_MAP_LONG_SIDE / 32)) - 1
    : Math.max(3, Math.floor(ILLUM_MAP_LONG_SIDE / 32));

export const FF_FLOOR_DEFAULT = 40;

export const UNSHARP_AMOUNT = 0.5;
export const UNSHARP_RADIUS = 1.5;
export const UNSHARP_KERNEL = 7;

// ─── F-TEXT-SMOOTH (legado — pipeline de ganancia ink/src reemplazado) ──────
/** LEGADO: tope de la ganancia por píxel del pipeline ink/src. La rama text
 *  usa F-TEXT-CLEAN (sin división singular); se conservan por compatibilidad
 *  con applyModelAndGainToRgba (modos legacy/external). */
export const TEXT_GAIN_MAX = 4;
/** Tope del factor TOTAL (modelo de sombra × ganancia) al aplicarse al RGBA:
 *  amortigua outliers extremos sin tocar el look del filtro. */
export const APPLY_FACTOR_MAX = 8;

// ─── Utilidades básicas ─────────────────────────────────────────────────────

/** Luma entera: (R·77 + G·150 + B·29) >> 8 — idéntica al worker. */
export function rgbaToGray(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || data.length < n * 4) return new Uint8ClampedArray(0);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[i] = ((data[o]! * 77 + data[o + 1]! * 150 + data[o + 2]! * 29) >> 8) as number;
  }
  return out;
}

export function grayToRgba(gray: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || gray.length < n) return new Uint8ClampedArray(0);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const v = gray[i]!;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  }
  return out;
}

// ─── Bradley-Roth + Sauvola + despeckle (B/N adaptativo) ────────────────────

function integralImage(gray: Uint8ClampedArray, w: number, h: number): Float64Array {
  if (!(w > 0) || !(h > 0) || gray.length < w * h) return new Float64Array(0);
  const iw = w + 1;
  const ii = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowAcc = 0;
    const src = y * w;
    const dst = (y + 1) * iw;
    const prev = y * iw;
    for (let x = 0; x < w; x++) {
      rowAcc += gray[src + x]!;
      ii[dst + x + 1] = ii[prev + x + 1]! + rowAcc;
    }
  }
  return ii;
}

function integralImageSq(gray: Uint8ClampedArray, w: number, h: number): Float64Array {
  if (!(w > 0) || !(h > 0) || gray.length < w * h) return new Float64Array(0);
  const iw = w + 1;
  const ii = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowAcc = 0;
    const src = y * w;
    const dst = (y + 1) * iw;
    const prev = y * iw;
    for (let x = 0; x < w; x++) {
      const v = gray[src + x]!;
      rowAcc += v * v;
      ii[dst + x + 1] = ii[prev + x + 1]! + rowAcc;
    }
  }
  return ii;
}

function oddWindow(w: number, windowRatio: number): number {
  const raw = Math.max(8, Math.round(w * windowRatio));
  return raw % 2 === 0 ? raw + 1 : raw;
}

/** Bradley-Roth (integral image) — umbral LOCAL, inmune a sombras. Verbatim. */
export function bradleyRoth(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  t: number = BW_T,
  windowRatio: number = BW_WINDOW_RATIO
): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || gray.length < n) return new Uint8ClampedArray(0);
  const ii = integralImage(gray, w, h);
  const iw = w + 1;
  const half = oddWindow(w, windowRatio) >> 1;
  const out = new Uint8ClampedArray(n);
  const k = 1 - t;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    const r0 = y0 * iw;
    const r1 = (y1 + 1) * iw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const sum = ii[r1 + x1 + 1]! - ii[r0 + x1 + 1]! - ii[r1 + x0]! + ii[r0 + x0]!;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const m = sum / count;
      out[row + x] = gray[row + x]! <= m * k ? 0 : 255;
    }
  }
  return out;
}

/** Sauvola (respaldo, misma maquinaria + integral de cuadrados). */
export function sauvola(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  k: number = BW_SAUVOLA_K,
  r: number = BW_SAUVOLA_R,
  windowRatio: number = BW_WINDOW_RATIO
): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || gray.length < n) return new Uint8ClampedArray(0);
  const ii = integralImage(gray, w, h);
  const iiSq = integralImageSq(gray, w, h);
  const iw = w + 1;
  const half = oddWindow(w, windowRatio) >> 1;
  const out = new Uint8ClampedArray(n);
  const rr = r > 0 ? r : 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h - 1, y + half);
    const r0 = y0 * iw;
    const r1 = (y1 + 1) * iw;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w - 1, x + half);
      const c0 = x0;
      const c1 = x1 + 1;
      const count = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = ii[r1 + c1]! - ii[r0 + c1]! - ii[r1 + c0]! + ii[r0 + c0]!;
      const sumSq = iiSq[r1 + c1]! - iiSq[r0 + c1]! - iiSq[r1 + c0]! + iiSq[r0 + c0]!;
      const m = sum / count;
      const variance = sumSq / count - m * m;
      const s = Math.sqrt(variance > 0 ? variance : 0);
      const t = m * (1 + k * (s / rr - 1));
      out[row + x] = gray[row + x]! <= t ? 0 : 255;
    }
  }
  return out;
}

/** Despeckle: flood fill 4-conectividad, componentes de tinta < minPx fuera. */
export function despeckleBinary(
  binary: Uint8ClampedArray,
  w: number,
  h: number,
  minPx: number = BW_DESPECKLE_PX
): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || binary.length < n) return binary.slice();
  if (!(minPx > 1)) return binary.slice();
  const out = binary.slice();
  const visited = new Uint8Array(n);
  const queue = new Int32Array(n);
  for (let seed = 0; seed < n; seed++) {
    if (visited[seed] !== 0 || binary[seed] !== 0) continue;
    visited[seed] = 1;
    let r = 0;
    let sp = 0;
    queue[sp++] = seed;
    while (r < sp) {
      const i = queue[r++]!;
      const x = i % w;
      if (x > 0 && visited[i - 1] === 0 && binary[i - 1] === 0) {
        visited[i - 1] = 1;
        queue[sp++] = i - 1;
      }
      if (x < w - 1 && visited[i + 1] === 0 && binary[i + 1] === 0) {
        visited[i + 1] = 1;
        queue[sp++] = i + 1;
      }
      if (i >= w && visited[i - w] === 0 && binary[i - w] === 0) {
        visited[i - w] = 1;
        queue[sp++] = i - w;
      }
      if (i < n - w && visited[i + w] === 0 && binary[i + w] === 0) {
        visited[i + w] = 1;
        queue[sp++] = i + w;
      }
    }
    if (sp < minPx) {
      for (let j = 0; j < sp; j++) out[queue[j]!] = 255;
    }
  }
  return out;
}

// ─── Texto claro ────────────────────────────────────────────────────────────

/** White-point stretch por percentil (hist 256 bins). Verbatim. */
export function whitePointStretchPct(
  gray: Uint8ClampedArray,
  pct: number
): Uint8ClampedArray {
  const n = gray.length;
  if (!(n > 0)) return new Uint8ClampedArray(0);
  const p = Math.min(1, Math.max(0, pct));
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]!]! += 1;
  const target = Math.ceil(n * p);
  let acc = 0;
  let pivot = 255;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= target) {
      pivot = v;
      break;
    }
  }
  if (pivot <= 0) return gray.slice();
  const scale = 255 / pivot;
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const v = Math.round(gray[i]! * scale);
    out[i] = v > 255 ? 255 : v;
  }
  return out;
}

/** S-curve (Texto claro). Verbatim. */
export function textClaroContrast(
  gray: Uint8ClampedArray,
  contrast: number = TEXT_CLARO_CONTRAST,
  pivot: number = TEXT_CLARO_PIVOT
): Uint8ClampedArray {
  const n = gray.length;
  const out = new Uint8ClampedArray(n);
  if (!(n > 0)) return out;
  for (let i = 0; i < n; i++) {
    const v = gray[i]! / 255;
    out[i] = ((v - pivot) * contrast + pivot) * 255;
  }
  return out;
}

// ─── F-TEXT-CLEAN (pipeline estabilizado del "Texto claro") ─────────────────

/**
 * LUT 256 del mapeo sigmoidal tinta/fondo del modo text.
 *
 * `wp` es entero 0-255, así que el mapeo por píxel del plan (Math.pow por
 * muestra) es equivalente a esta LUT de 256 entradas — misma matemática,
 * 256 Math.pow en vez de w·h (≈12 MP → ~0.1 s solo en pow).
 *
 * - Papel (v ≥ pivot): smoothstep hacia 1.0 — ≥ 0.92 cae a blanco 255
 *   sin corte abrupto (adiós textura moteada).
 * - Tinta (v < pivot): (v/pivot)^contrast · pivot — contraste controlado
 *   con continuidad C¹ en el pivote.
 * - Rodilla en black point: inkVal < bp ⇒ inkVal²/bp — cae a 0 suave.
 */
export function textTargetLumaLut(
  contrast: number = TEXT_CLARO_CONTRAST,
  pivot: number = TEXT_CLARO_PIVOT,
  bp: number = TEXT_CLARO_BLACK_POINT
): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const p = Math.min(0.99, Math.max(0.01, pivot));
  const knee = Math.min(p, Math.max(0, bp));
  for (let idx = 0; idx < 256; idx++) {
    const v = idx / 255;
    if (v >= p) {
      const t = (v - p) / (1 - p);
      const smooth = p + (1 - p) * (t * t * (3 - 2 * t));
      lut[idx] = smooth > 0.92 ? 255 : Math.round(smooth * 255);
    } else {
      let inkVal = Math.pow(v / p, contrast) * p;
      if (inkVal < knee) inkVal = Math.max(0, inkVal * (inkVal / knee));
      lut[idx] = Math.round(inkVal * 255);
    }
  }
  return lut;
}

/** Umbral de gradiente (|Δx|+|Δy|) para considerar "borde de tinta". */
export const TEXT_EDGE_GRADIENT = 25;
/** Afilado edge-aware SOLO donde hay borde de tinta — 1 pasada. */
export const TEXT_EDGE_AMOUNT = 0.75;

/**
 * Afilado selectivo de bordes sobre luma (1 pasada, máscara Laplaciana).
 *
 * Solo toca píxeles con gradiente local > TEXT_EDGE_GRADIENT y luma < 240
 * (bordes de texto): el papel plano NUNCA se afila, así el grano del sensor
 * no se convierte en motas (por eso el modo text ya NO necesita el unsharp
 * global previo). Márgenes de 1 px se copian sin procesar.
 */
export function edgeAwareSharpenGray(
  src: Uint8ClampedArray,
  w: number,
  h: number
): Uint8ClampedArray {
  const n = w * h;
  const out = new Uint8ClampedArray(n);
  if (!(n > 0) || src.length < n) return out;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const idx = row + x;
      const c = src[idx]!;
      const grad =
        Math.abs(src[idx + 1]! - src[idx - 1]!) +
        Math.abs(src[idx + w]! - src[idx - w]!);
      if (grad > TEXT_EDGE_GRADIENT && c < 240) {
        const lap = (src[idx - 1]! + src[idx + 1]! + src[idx - w]! + src[idx + w]!) * 0.25 - c;
        out[idx] = Math.max(0, Math.min(255, Math.round(c - lap * TEXT_EDGE_AMOUNT)));
      } else {
        out[idx] = c;
      }
    }
  }
  // Márgenes de 1 px sin procesar
  for (let x = 0; x < w; x++) {
    out[x] = src[x]!;
    out[(h - 1) * w + x] = src[(h - 1) * w + x]!;
  }
  for (let y = 0; y < h; y++) {
    out[y * w] = src[y * w]!;
    out[y * w + w - 1] = src[y * w + w - 1]!;
  }
  return out;
}

/** Luma a partir de la cual un píxel de destino cuenta como fondo blanco. */
export const TEXT_WHITE_TARGET = 253;
/** Tinta por debajo de esta luma converge a negro neutro (sin fosforitos). */
export const TEXT_NEUTRAL_INK = 45;
/** Desde esta luma el croma se desvanece linealmente hacia neutro: el papel
 *  (tgt ≈ 209-252 tras el estiramiento) no puede retener ruido de croma —
 *  en sombra profunda la escala tgt/luma (hasta ×6) amplificaría el ruido
 *  ISO por canal en la frontera del blanco (fosforitos). */
export const TEXT_CHROMA_FADE_START = 200;
/** Tope de amplificación de croma: la escala tgt/luma multiplica la LUMA
 *  objetivo, pero el ruido de croma del sensor no debe crecer con ella —
 *  se limita a ×1.5 (luz normal, escala ≤1.5 ⇒ croma intacto). */
export const TEXT_CHROMA_MAX_GAIN = 1.5;

/**
 * Reconstrucción RGBA con preservación de croma — el paso que elimina las
 * aberraciones cromáticas del pipeline de ganancia.
 *
 * Antes (applyModelAndGainToRgba): cada canal se multiplicaba y clamp-eaba
 * por separado ⇒ el canal que llegaba antes a 255 viraba el tono a
 * amarillo/magenta, y la ganancia ink/src amplificaba ruido hasta 4-8x.
 *
 * Ahora: escala UNIFORME de los 3 canales por tgt/luma_original ⇒ el tono
 * de la tinta se preserva exacto (bolígrafo azul sigue azul). Invariantes:
 * - tgt ≥ 253  ⇒ fondo blanco 255/255/255 inmaculado.
 * - tgt < 45   ⇒ convergencia a negro neutro (mata píxeles fosforitos).
 * - tgt > 200  ⇒ el croma se desvanece hacia neutro al acercarse al blanco
 *   (F-TEXT-CLEAN: sin ruido de color en la frontera del papel).
 * - La desviación de croma nunca se amplifica más de TEXT_CHROMA_MAX_GAIN
 *   respecto al original (el ruido ISO no crece con la escala de sombra).
 */
export function rebuildRgbaWithChroma(
  data: Uint8ClampedArray,
  gray: Uint8ClampedArray,
  targetLuma: Uint8ClampedArray,
  w: number,
  h: number
): Uint8ClampedArray {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  if (!(n > 0) || data.length < n * 4 || gray.length < n || targetLuma.length < n) return out;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const tgt = targetLuma[i]!;
    const srcL = gray[i]!;
    if (tgt >= TEXT_WHITE_TARGET) {
      // Fondo blanco inmaculado
      out[o] = 255;
      out[o + 1] = 255;
      out[o + 2] = 255;
    } else {
      // Escalar canales RGB preservando el tono exacto de la tinta
      const scale = srcL > 5 ? tgt / srcL : 1;
      let r = Math.min(255, Math.round(data[o]! * scale));
      let g = Math.min(255, Math.round(data[o + 1]! * scale));
      let b = Math.min(255, Math.round(data[o + 2]! * scale));
      if (tgt > TEXT_CHROMA_FADE_START) {
        // Zona papel: croma → neutro al acercarse al blanco (el ruido ISO
        // amplificado por la escala no genera halos en la frontera).
        const keep = Math.max(0, (TEXT_WHITE_TARGET - tgt) / (TEXT_WHITE_TARGET - TEXT_CHROMA_FADE_START));
        r = Math.round(tgt + (r - tgt) * keep);
        g = Math.round(tgt + (g - tgt) * keep);
        b = Math.round(tgt + (b - tgt) * keep);
      }
      if (scale > TEXT_CHROMA_MAX_GAIN) {
        // Sombra profunda: la desviación de croma (data_c − luma) no se
        // amplifica con la escala — solo la luma objetivo crece.
        const dKeep = TEXT_CHROMA_MAX_GAIN / scale;
        r = Math.round(tgt + (r - tgt) * dKeep);
        g = Math.round(tgt + (g - tgt) * dKeep);
        b = Math.round(tgt + (b - tgt) * dKeep);
      }
      if (tgt < TEXT_NEUTRAL_INK) {
        // Tinta oscura: converger a negro neutro
        const blend = tgt / TEXT_NEUTRAL_INK;
        out[o] = Math.round(r * blend + tgt * (1 - blend));
        out[o + 1] = Math.round(g * blend + tgt * (1 - blend));
        out[o + 2] = Math.round(b * blend + tgt * (1 - blend));
      } else {
        out[o] = r;
        out[o + 1] = g;
        out[o + 2] = b;
      }
    }
    out[o + 3] = 255;
  }
  return out;
}

// ─── Modelo de sombra (corrección de iluminación) ───────────────────────────

function sampleDownscale(
  gray: Uint8ClampedArray,
  w: number,
  h: number,
  mw: number,
  mh: number
): Float64Array {
  const map = new Float64Array(mw * mh);
  for (let my = 0; my < mh; my++) {
    const y = Math.min(h - 1, Math.floor(((my + 0.5) * h) / mh));
    for (let mx = 0; mx < mw; mx++) {
      const x = Math.min(w - 1, Math.floor(((mx + 0.5) * w) / mw));
      map[my * mw + mx] = gray[y * w + x]!;
    }
  }
  return map;
}

/** Min/max deslizante O(n) (monotonic deque). */
function slidingMinMax1D(src: Float64Array, n: number, k: number, isMax: boolean): Float64Array {
  const causal = new Float64Array(n);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const better = (a: number, b: number) => (isMax ? a >= b : a <= b);
  for (let i = 0; i < n; i++) {
    while (tail > head && better(src[i]!, src[dq[tail - 1]!]!)) tail--;
    dq[tail] = i;
    tail++;
    while (dq[head]! <= i - k) head++;
    causal[i] = src[dq[head]!]!;
  }
  const half = (k - 1) >> 1;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const e = Math.min(n - 1, i + half);
    out[i] = causal[e]!;
  }
  return out;
}

/** Close morfológico (dilate+erode) separable. */
function morphClose(map: Float64Array, mw: number, mh: number, k: number): Float64Array {
  const hmax = new Float64Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const row = slidingMinMax1D(map.subarray(y * mw, (y + 1) * mw), mw, k, true);
    hmax.set(row, y * mw);
  }
  const dil = new Float64Array(mw * mh);
  for (let x = 0; x < mw; x++) {
    const col = new Float64Array(mh);
    for (let y = 0; y < mh; y++) col[y] = hmax[y * mw + x]!;
    const r = slidingMinMax1D(col, mh, k, true);
    for (let y = 0; y < mh; y++) dil[y * mw + x] = r[y]!;
  }
  const hmin = new Float64Array(mw * mh);
  for (let y = 0; y < mh; y++) {
    const row = slidingMinMax1D(dil.subarray(y * mw, (y + 1) * mw), mw, k, false);
    hmin.set(row, y * mw);
  }
  const ero = new Float64Array(mw * mh);
  for (let x = 0; x < mw; x++) {
    const col = new Float64Array(mh);
    for (let y = 0; y < mh; y++) col[y] = hmin[y * mw + x]!;
    const r = slidingMinMax1D(col, mh, k, false);
    for (let y = 0; y < mh; y++) ero[y * mw + x] = r[y]!;
  }
  return ero;
}

function estimateIlluminationMap(
  gray: Uint8ClampedArray,
  w: number,
  h: number
): { map: Float64Array; mw: number; mh: number } {
  const scale = Math.min(1, ILLUM_MAP_LONG_SIDE / Math.max(w, h));
  const mw = Math.max(1, Math.round(w * scale));
  const mh = Math.max(1, Math.round(h * scale));
  const reduced = sampleDownscale(gray, w, h, mw, mh);
  const map = mw * mh <= 1 ? reduced : morphClose(reduced, mw, mh, ILLUM_KERNEL);
  return { map, mw, mh };
}

export interface ShadowModel {
  gains: Float32Array;
  xMap: Uint16Array;
  yMap: Uint16Array;
  mw: number;
}

/** Normaliza a la MEDIA: el fondo queda parejo sin inflar. */
export function estimateShadowModel(
  gray: Uint8ClampedArray,
  w: number,
  h: number
): ShadowModel {
  const { map, mw, mh } = estimateIlluminationMap(gray, w, h);
  let acc = 0;
  for (let i = 0; i < map.length; i++) acc += map[i]!;
  const mean2 = map.length > 0 ? acc / map.length : 255;
  const gains = new Float32Array(map.length);
  for (let i = 0; i < map.length; i++) {
    gains[i] = map[i]! > 0 ? mean2 / map[i]! : 1;
  }
  const xMap = new Uint16Array(w);
  const yMap = new Uint16Array(h);
  for (let x = 0; x < w; x++) xMap[x] = Math.min(mw - 1, Math.floor((x * mw) / w));
  for (let y = 0; y < h; y++) yMap[y] = Math.min(mh - 1, Math.floor((y * mh) / h));
  return { gains, xMap, yMap, mw };
}

/** Aplica el modelo de sombra al gris — F-TEXT-SMOOTH: muestreo BILINEAR
 *  del mapa de ganancias (antes nearest: cada celda del mapa (~800 px del
 *  lado largo) era un bloque de ~5 px con ganancia saltante → píxeles feos
 *  en el papel). Bilinear = iluminación pareja y continua. */
export function correctedGrayWithModel(
  gray: Uint8ClampedArray,
  model: ShadowModel,
  w: number,
  h: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  const mw = model.mw > 0 ? model.mw : 1;
  const mh = Math.max(1, Math.floor(model.gains.length / mw));
  const gains = model.gains;
  // Precomputa el muestreo horizontal por columna (fx, x0, x1, tx).
  const x0Arr = new Int32Array(w);
  const x1Arr = new Int32Array(w);
  const txArr = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x * mw) / w;
    const x0 = Math.min(mw - 1, Math.floor(fx));
    x0Arr[x] = x0;
    x1Arr[x] = x0 + 1 < mw ? x0 + 1 : x0;
    txArr[x] = Math.min(1, Math.max(0, fx - x0));
  }
  for (let y = 0; y < h; y++) {
    const fy = (y * mh) / h;
    const y0 = Math.min(mh - 1, Math.floor(fy));
    const y1 = y0 + 1 < mh ? y0 + 1 : y0;
    const ty = Math.min(1, Math.max(0, fy - y0));
    const r0 = y0 * mw;
    const r1 = y1 * mw;
    const rowOut = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = x0Arr[x]!;
      const x1 = x1Arr[x]!;
      const tx = txArr[x]!;
      const g00 = gains[r0 + x0]!;
      const g01 = gains[r0 + x1]!;
      const g10 = gains[r1 + x0]!;
      const g11 = gains[r1 + x1]!;
      const top = g00 + (g01 - g00) * tx;
      const bottom = g10 + (g11 - g10) * tx;
      out[rowOut + x] = gray[rowOut + x]! * (top + (bottom - top) * ty);
    }
  }
  return out;
}

/** Ganancia por píxel conservando croma — LEGADO (pipeline ink/src del modo
 *  text hasta F-TEXT-CLEAN; natural/external aún la usan): bilinear (ver
 *  correctedGrayWithModel) + tope del factor total (APPLY_FACTOR_MAX). */
export function applyModelAndGainToRgba(
  data: Uint8ClampedArray,
  model: ShadowModel,
  gain: Float32Array,
  w: number,
  h: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const mw = model.mw > 0 ? model.mw : 1;
  const mh = Math.max(1, Math.floor(model.gains.length / mw));
  const gains = model.gains;
  const x0Arr = new Int32Array(w);
  const x1Arr = new Int32Array(w);
  const txArr = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x * mw) / w;
    const x0 = Math.min(mw - 1, Math.floor(fx));
    x0Arr[x] = x0;
    x1Arr[x] = x0 + 1 < mw ? x0 + 1 : x0;
    txArr[x] = Math.min(1, Math.max(0, fx - x0));
  }
  for (let y = 0; y < h; y++) {
    const fy = (y * mh) / h;
    const y0 = Math.min(mh - 1, Math.floor(fy));
    const y1 = y0 + 1 < mh ? y0 + 1 : y0;
    const ty = Math.min(1, Math.max(0, fy - y0));
    const r0 = y0 * mw;
    const r1 = y1 * mw;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      const x0 = x0Arr[x]!;
      const x1 = x1Arr[x]!;
      const tx = txArr[x]!;
      const g00 = gains[r0 + x0]!;
      const g01 = gains[r0 + x1]!;
      const g10 = gains[r1 + x0]!;
      const g11 = gains[r1 + x1]!;
      const top = g00 + (g01 - g00) * tx;
      const bottom = g10 + (g11 - g10) * tx;
      const factor = Math.min(
        APPLY_FACTOR_MAX,
        Math.max(0, (top + (bottom - top) * ty) * gain[i]!)
      );
      out[o] = data[o]! * factor;
      out[o + 1] = data[o + 1]! * factor;
      out[o + 2] = data[o + 2]! * factor;
      out[o + 3] = data[o + 3]!;
    }
  }
  return out;
}

// ─── Unsharp (en enhance, mode ≠ raw, ANTES del filtro — §8) ────────────────

/** Kernel gaussiano 1D normalizado. */
export function gaussianKernel1D(k: number, sigma: number): Float32Array {
  const half = (k - 1) / 2;
  const kern = new Float32Array(k);
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const d = i - half;
    const v = Math.exp(-(d * d) / (2 * sigma * sigma));
    kern[i] = v;
    sum += v;
  }
  for (let i = 0; i < k; i++) kern[i] = kern[i]! / sum;
  return kern;
}

function blurChannel(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  kern: Float32Array
): Uint8ClampedArray {
  const half = (kern.length - 1) >> 1;
  const tmp = new Float64Array(w * h);
  const out = new Uint8ClampedArray(w * h);
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = 0; k < kern.length; k++) {
        const sx = Math.min(w - 1, Math.max(0, x + k - half));
        acc += src[row + sx]! * kern[k]!;
      }
      tmp[row + x] = acc;
    }
  }
  // vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let k = 0; k < kern.length; k++) {
        const sy = Math.min(h - 1, Math.max(0, y + k - half));
        acc += tmp[sy * w + x]! * kern[k]!;
      }
      out[y * w + x] = acc;
    }
  }
  return out;
}

/**
 * Unsharp sobre RGBA: blur gaussiano separable k=7 σ=1.5 →
 * src = src·(1+0.5) − blur·0.5 (equivalente a addWeighted).
 */
export function unsharpRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number = UNSHARP_AMOUNT,
  sigma: number = UNSHARP_RADIUS
): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || data.length < n * 4) return data;
  const kern = gaussianKernel1D(UNSHARP_KERNEL, sigma);
  const r = new Uint8ClampedArray(n);
  const g = new Uint8ClampedArray(n);
  const b = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    r[i] = data[o]!;
    g[i] = data[o + 1]!;
    b[i] = data[o + 2]!;
  }
  const rB = blurChannel(r, w, h, kern);
  const gB = blurChannel(g, w, h, kern);
  const bB = blurChannel(b, w, h, kern);
  const out = data.slice();
  const k1 = 1 + amount;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    out[o] = r[i]! * k1 - rB[i]! * amount;
    out[o + 1] = g[i]! * k1 - gB[i]! * amount;
    out[o + 2] = b[i]! * k1 - bB[i]! * amount;
  }
  return out;
}

// ─── Pipeline por modo (enhanceToRgba — VERBATIM del worker) ────────────────

export interface EnhanceOptions {
  textWhitePct?: number;
  textContrast?: number;
  textPivot?: number;
  textBlackPoint?: number;
  bwT?: number;
  bwWindowRatio?: number;
  bwMethod?: "bradley" | "sauvola";
  bwSauvolaK?: number;
  bwDespecklePx?: number;
  grayWhitePct?: number;
}

export type EnhanceMode = "raw" | "text" | "bw" | "gray";

/** Mime de salida por modo (R-10: PNG lossless para tinta). */
export function enhanceMime(mode: EnhanceMode): "image/png" | "image/jpeg" {
  return mode === "raw" || mode === "text" || mode === "bw" ? "image/png" : "image/jpeg";
}

/**
 * Pipeline exacto del worker sobre RGBA:
 *
 *   gray = luma entera
 *   shadow = estimateShadowModel(gray)     — TODOS los modos menos raw
 *   grayS = gray × shadow.gains            — corrección de iluminación
 *
 *   raw : passthrough (solo alpha→255)
 *   text: grayS → whitePointStretchPct(0.95) → LUT sigmoidal
 *         (papel ≥ 0.82 → smoothstep a blanco; tinta (v/0.82)^1.45 con
 *         rodilla cuadrática en blackPoint 0.15) → afilado edge-aware
 *         (solo bordes, grad>25 — el papel nunca se toca) →
 *         rebuildRgbaWithChroma (escala uniforme tgt/luma: sin división
 *         singular ink/src ni clamp por canal — F-TEXT-CLEAN)
 *   bw  : grayS → bradleyRoth(t=0.15, ventana w/12) → despeckleBinary(3)
 *   gray: grayS → whitePointStretchPct(0.97)
 */
export function enhanceToRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  mode: EnhanceMode,
  opts: EnhanceOptions = {}
): Uint8ClampedArray {
  const n = w * h;
  if (!(n > 0) || data.length < n * 4) return new Uint8ClampedArray(0);
  if (mode === "raw") {
    const out = data.slice(0, n * 4);
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return out;
  }
  const gray = rgbaToGray(data, w, h);
  const shadow = estimateShadowModel(gray, w, h);
  if (mode === "bw") {
    const grayS = correctedGrayWithModel(gray, shadow, w, h);
    const bin =
      opts.bwMethod === "sauvola"
        ? sauvola(grayS, w, h, opts.bwSauvolaK ?? BW_SAUVOLA_K, BW_SAUVOLA_R, opts.bwWindowRatio ?? BW_WINDOW_RATIO)
        : bradleyRoth(grayS, w, h, opts.bwT ?? BW_T, opts.bwWindowRatio ?? BW_WINDOW_RATIO);
    const clean =
      opts.bwDespecklePx !== 0 ? despeckleBinary(bin, w, h, opts.bwDespecklePx ?? BW_DESPECKLE_PX) : bin;
    return grayToRgba(clean, w, h);
  }
  if (mode === "gray") {
    const grayS = correctedGrayWithModel(gray, shadow, w, h);
    return grayToRgba(whitePointStretchPct(grayS, opts.grayWhitePct ?? 0.97), w, h);
  }
  // mode === "text" — F-TEXT-CLEAN: pipeline estabilizado SIN división
  // singular (gainW = ink/src amplificaba ruido ×4-8 en sombras/ruido ISO),
  // SIN clamp asimétrico por canal (viraje amarillo/magenta) y SIN unsharp
  // global previo (grano del sensor sobre el papel).
  const grayS = correctedGrayWithModel(gray, shadow, w, h);
  const wp = whitePointStretchPct(grayS, opts.textWhitePct ?? TEXT_CLARO_WHITE_PCT);
  // 1. Mapeo sigmoidal de tinta y fondo vía LUT (wp es entero 0-255 →
  //    matemática idéntica al cálculo por píxel, coste O(256) no O(n)).
  const lut = textTargetLumaLut(
    opts.textContrast ?? TEXT_CLARO_CONTRAST,
    opts.textPivot ?? TEXT_CLARO_PIVOT,
    opts.textBlackPoint ?? TEXT_CLARO_BLACK_POINT
  );
  const targetLuma = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) targetLuma[i] = lut[wp[i]!]!;
  // 2. Afilado selectivo SOLO en bordes de tinta (1 pasada).
  const sharpLuma = edgeAwareSharpenGray(targetLuma, w, h);
  // 3. Reconstrucción RGBA con preservación de croma (cero aberraciones).
  return rebuildRgbaWithChroma(data, gray, sharpLuma, w, h);
}
