/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Procesamiento de imágenes del escáner.
 *
 * INTEGRACIÓN REAL ✅ (logica-deteccion.zip): detección, rectificado y realce
 * delegados al DetectionWorker del usuario (OpenCV.js 4.5.5 self-hosted):
 *  - detect: contornos → quads → selección por score (área + prior + blancura)
 *  - warp  : refinado sub-píxel por líneas (RANSAC) + shrink 3.5px/lado +
 *            homografía INTER_CUBIC — la FOTO es la fuente de verdad
 *  - enhance: modos reales (text/bw/gray/raw/color) con modelo de sombras
 *            común y constantes exactas del producto
 *
 * Cada función degrada con gracia: si el worker no está disponible (SSR,
 * OpenCV que no carga, navegador sin OffscreenCanvas) cae al pipeline Canvas
 * local anterior — la app NUNCA se rompe.
 */

import type { PageFilter, PagePrecision, PageQuality, Point, Quad } from "./types";
import { normalizePageFilter } from "./types";
import { enhanceToRgba, unsharpRgba, type EnhanceMode as SharedEnhanceMode } from "./image-modes";
import {
  getScannerWorker,
  type EnhanceMode,
  type ScannerWorkerClient,
} from "./detector-client";

export { warmUpScannerWorker, getScannerWorker } from "./detector-client";

export interface ProcessResult {
  processed: string; // data URL
  thumbnail: string; // data URL pequeña
  /** Estadísticas del pipeline REAL (worker OpenCV) o fallback canvas. */
  precision?: PagePrecision;
}

/** Opciones del pipeline preciso (aditivas, con defaults seguros). */
export interface ProcessOptions {
  /** Quad colocado por el humano → sin refine, sin shrink (F5-MANUAL). */
  manual?: boolean;
  /** Lado mayor máximo del resultado procesado (default PROCESSED_MAX_LONG_SIDE). */
  maxLongSide?: number;
  /** true = aplica unsharp (0.5/1.5) al filtro Original (que por fidelidad
   *  al sensor F5-RAW se guarda puro). No afecta a los demás filtros:
   *  el enhance real del worker ya aplica unsharp en todo modo ≠ raw. */
  unsharpOriginal?: boolean;
}

/** Lado mayor tope del resultado. 4032 (bug v3 de CALIDAD: estaba en 3200 y
 *  RECORTABA la foto completa del sensor — el iPhone captura a 4032px, así
 *  que el pipeline tiraba ~21% de resolución que codigo-test sí conservaba
 *  al usar maxLongSide 0 = resolución completa). 4032×3024 ≈ 12.2 MP, aún
 *  por debajo del límite de canvas de iOS (~16.7 MP); IndexedDB guarda
 *  Blobs → sin problema de cuota. */
const PROCESSED_MAX_LONG_SIDE = 4032;

/** Mapea los 3 filtros del producto (§8) a los modos reales del worker. */
export function filterToEnhanceMode(filter: PageFilter): EnhanceMode {
  switch (normalizePageFilter(filter)) {
    case "original":
      return "raw";
    case "bw":
      return "bw"; // Bradley-Roth adaptativo + despeckle
    default:
      return "text"; // "Texto claro" — el default del producto
  }
}

/** Modo compartido (image-modes) — el fallback usa ESTE y solo ESTE. */
function filterToSharedMode(filter: PageFilter): SharedEnhanceMode {
  switch (normalizePageFilter(filter)) {
    case "original":
      return "raw";
    case "bw":
      return "bw";
    default:
      return "text";
  }
}

/** ¿El pipeline de precisión (worker + OpenCV) está activo? */
export function isPrecisionActive(): boolean {
  return getScannerWorker()?.isReady ?? false;
}

/** Carga una imagen (data URL o URL) en un HTMLImageElement. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo cargar la imagen"));
    img.src = src;
  });
}

/** Tope del lado mayor para IMÁGENES IMPORTADAS (galería/cámara nativa).
 *  Igual que PROCESSED_MAX_LONG_SIDE: 4032×3024 ≈ 12.2 MP decodifican y
 *  dibujan bien incluso en iOS (límite de canvas ~16.7 MP). */
const IMPORT_MAX_LONG_SIDE = 4032;

/** Dibuja cualquier CanvasImageSource a un canvas topeado por su lado mayor
 *  (sin upscalar) y lo devuelve como data URL JPEG 0.92. */
function sourceToCappedJpegDataUrl(
  src: CanvasImageSource,
  sw: number,
  sh: number,
  maxLongSide = IMPORT_MAX_LONG_SIDE
): Promise<string> {
  const scale = Math.min(1, maxLongSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("sin contexto 2d"));
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  return canvasToDataURL(canvas, "image/jpeg", 0.92);
}

/**
 * F-HEIC — decodificador HEIC/HEIF en cliente (libheif vía heic2any).
 * Chrome/Android NO decodifica HEIC nativamente (las fotos de iPhone pasadas
 * por WhatsApp/Drive/copys fallaban con «No se pudo procesar la imagen»).
 * El chunk pesa ~1,4 MB así que se importa DINÁMICAMENTE: solo se descarga
 * la primera vez que una imagen realmente necesita el rescate (un JPG normal
 * nunca lo toca). heic2any empaqueta libheif inline — sin .wasm externo,
 * funciona igual en GitHub Pages.
 */
type Heic2Any = (opts: {
  blob: Blob;
  toType?: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

let heic2anyFn: Heic2Any | null = null;
let heic2anyPromise: Promise<Heic2Any> | null = null;

function loadHeic2Any(): Promise<Heic2Any> {
  if (heic2anyFn) return Promise.resolve(heic2anyFn);
  if (!heic2anyPromise) {
    heic2anyPromise = import("heic2any")
      .then((mod) => {
        heic2anyFn = mod.default as Heic2Any;
        return heic2anyFn;
      })
      .catch((err) => {
        heic2anyPromise = null; // permite reintentar (p.ej. red recuperada)
        throw err;
      });
  }
  return heic2anyPromise;
}

/** HEIC/HEIF (o .jpg con contenido HEIC) → JPEG decodificable. */
async function convertHeicToJpegBlob(source: Blob): Promise<Blob> {
  const convert = await loadHeic2Any();
  const out = await convert({ blob: source, toType: "image/jpeg", quality: 0.92 });
  return Array.isArray(out) ? out[0] : out;
}

/** Intenta decodificar un Blob con la cascada NATIVA del navegador y
 *  devolver un data URL JPEG topeado. Devuelve null si nada funciona
 *  (HEIC en Android llega aquí y devuelve null → activa el rescate F-HEIC). */
async function nativeDecodeToCappedDataUrl(blob: Blob): Promise<string | null> {
  if (typeof createImageBitmap === "function") {
    const attempts: Array<Promise<ImageBitmap>> = [];
    try {
      attempts.push(
        createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions)
      );
    } catch {
      /* opciones no soportadas */
    }
    attempts.push(createImageBitmap(blob));
    for (const attempt of attempts) {
      let bm: ImageBitmap | null = null;
      try {
        bm = await attempt;
        if (bm.width > 0 && bm.height > 0) {
          return await sourceToCappedJpegDataUrl(bm, bm.width, bm.height);
        }
      } catch {
        /* siguiente intento */
      } finally {
        try {
          bm?.close();
        } catch {
          /* noop */
        }
      }
    }
  }

  // objectURL → <img> → canvas (el navegador decodifica y aplica EXIF al pintar).
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImage(objectUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    return await sourceToCappedJpegDataUrl(img, w, h);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * F-IMPORT — File → data URL de forma ROBUSTA. Los archivos de galería/
 * cámara nativa llegan a 12–48 MP y con EXIF; la ruta vieja (FileReader →
 * data URL gigante → <img>) reventaba con fotos grandes y era el origen del
 * «No se pudo procesar la imagen».
 *
 * Cascada (de más barata a más costosa):
 *  1. Decodificación NATIVA (createImageBitmap con EXIF → bitmap a secas →
 *     <img> vía objectURL) — ver nativeDecodeToCappedDataUrl.
 *  2. F-HEIC: si lo nativo falla, conversión con libheif (heic2any) y se
 *     repite la cascada sobre el JPEG resultante. Cubre HEIC/HEIF real y
 *     también los «.jpg» que en realidad traen contenido HEIC (típico al
 *     pasar fotos de iPhone por apps de mensajería/nube). libheif rechaza
 *     en milisegundos archivos que no sean HEIF (firma ftyp), así que
 *     intentarlo con un JPEG corrupto no cuesta nada.
 */
export async function fileToCaptureDataUrl(file: File): Promise<string> {
  const looksHeic = /heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

  // 1) Ruta nativa (rápida; iOS decodifica HEIC aquí mismo).
  const direct = await nativeDecodeToCappedDataUrl(file);
  if (direct) return direct;

  // 2) Rescate F-HEIC: decodificar con libheif y reintentar sobre el JPEG.
  let heicConversionAttempted = false;
  try {
    const jpeg = await convertHeicToJpegBlob(file);
    heicConversionAttempted = true;
    const decoded = await nativeDecodeToCappedDataUrl(jpeg);
    if (decoded) return decoded;
  } catch {
    /* no era HEIC o falló la conversión → error abajo */
  }

  throw new Error(
    looksHeic || heicConversionAttempted
      ? "No se pudo convertir la imagen HEIC"
      : "No se pudo decodificar la imagen (formato no soportado o archivo corrupto)"
  );
}

/** Fuente de imagen para el pipeline: data URL o elemento YA decodificado
 *  (HTMLImageElement/HTMLCanvasElement). Pasar el elemento evita re-decodificar
 *  la foto de 12 MP en cada etapa de la captura (downscale→detect→quality).
 *  La ruta crítica pasa de 3 decodes a 1 (2 solo si hubo que re-escalar). */
export type ImageSource = string | HTMLImageElement | HTMLCanvasElement;

/** Decodifica solo si hace falta (string); el elemento pasa tal cual. */
function ensureDecoded(
  src: ImageSource
): Promise<HTMLImageElement | HTMLCanvasElement> {
  return typeof src === "string" ? loadImage(src) : Promise.resolve(src);
}

function sourceWidth(el: HTMLImageElement | HTMLCanvasElement): number {
  return el instanceof HTMLImageElement ? el.naturalWidth || el.width : el.width;
}

function sourceHeight(el: HTMLImageElement | HTMLCanvasElement): number {
  return el instanceof HTMLImageElement ? el.naturalHeight || el.height : el.height;
}

// ─── Helpers del pipeline preciso ───────────────────────────────────────────

function floatsToQuad(f: Float32Array): Quad {
  return [
    { x: f[0]!, y: f[1]! },
    { x: f[2]!, y: f[3]! },
    { x: f[4]!, y: f[5]! },
    { x: f[6]!, y: f[7]! },
  ];
}

function isValidQuadFloats(f: Float32Array | null): f is Float32Array {
  if (f === null || f.length !== 8) return false;
  for (let i = 0; i < 8; i++) {
    const v = f[i]!;
    if (!Number.isFinite(v) || v < -0.05 || v > 1.05) return false;
  }
  return true;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("blobToDataURL falló"));
    fr.readAsDataURL(blob);
  });
}

/** Dibuja un bitmap en canvas aplicando rotación de 90/180/270. */
function bitmapToRotatedCanvas(
  bitmap: ImageBitmap | HTMLCanvasElement | HTMLImageElement,
  rotation: number
): HTMLCanvasElement {
  const w = bitmap instanceof HTMLImageElement ? bitmap.naturalWidth : bitmap.width;
  const h = bitmap instanceof HTMLImageElement ? bitmap.naturalHeight : bitmap.height;
  const swapped = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = swapped ? h : w;
  canvas.height = swapped ? w : h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  if (rotation !== 0) {
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(bitmap as CanvasImageSource, -w / 2, -h / 2);
    ctx.restore();
  } else {
    ctx.drawImage(bitmap as CanvasImageSource, 0, 0);
  }
  return canvas;
}

/** Miniatura 160px de ancho desde un blob (resultado real del enhance). */
async function thumbnailFromBlob(blob: Blob): Promise<string> {
  try {
    const bm = await createImageBitmap(blob);
    const tW = 160;
    const tH = Math.max(1, Math.round((bm.height / bm.width) * tW));
    const canvas = document.createElement("canvas");
    canvas.width = tW;
    canvas.height = tH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bm, 0, 0, tW, tH);
    bm.close();
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return "";
  }
}

// ─── Unsharp client-side (constantes EXACTAS del usuario §6) ────────────────

/** UNSHARP_AMOUNT/RADIUS del core del usuario: 0.5 / 1.5 (kernel derivado 7). */
const UNSHARP_AMOUNT = 0.5;
const UNSHARP_RADIUS = 1.5;
const UNSHARP_KERNEL = 7;

/** Núcleo gaussiano 1D normalizado (mismo efecto que cv.GaussianBlur k7 σ1.5). */
function gaussianKernel1D(size: number, sigma: number): Float32Array {
  const half = (size - 1) / 2;
  const k = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const v = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma));
    k[i] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) k[i] /= sum;
  return k;
}

/** Desenfoque gaussiano separable sobre RGB (in place sobre una copia). */
function gaussianBlurRGBA(data: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const k = gaussianKernel1D(UNSHARP_KERNEL, UNSHARP_RADIUS);
  const half = (UNSHARP_KERNEL - 1) / 2;
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  // Pase horizontal
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let t = -half; t <= half; t++) {
        const xx = Math.min(w - 1, Math.max(0, x + t));
        const wgt = k[t + half]!;
        const i = (y * w + xx) * 4;
        r += data[i]! * wgt;
        g += data[i + 1]! * wgt;
        b += data[i + 2]! * wgt;
      }
      const o = (y * w + x) * 4;
      tmp[o] = r;
      tmp[o + 1] = g;
      tmp[o + 2] = b;
      tmp[o + 3] = data[o + 3]!;
    }
  }
  // Pase vertical
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let t = -half; t <= half; t++) {
        const yy = Math.min(h - 1, Math.max(0, y + t));
        const wgt = k[t + half]!;
        const i = (yy * w + x) * 4;
        r += tmp[i]! * wgt;
        g += tmp[i + 1]! * wgt;
        b += tmp[i + 2]! * wgt;
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = tmp[o + 3]!;
    }
  }
  return out;
}

/**
 * Unsharp mask EXACTO del producto, en cliente: addWeighted(src, 1.5, blur, −0.5, 0)
 * sobre un canvas — mismo efecto que el unsharpRgba del worker (GaussianBlur
 * k7 σ1.5 + amount 0.5). Se usa SOLO para el filtro Original con el toggle
 * de nitidez activo: el resto de modos ya reciben el unsharp del enhance real.
 */
export function applyUnsharpToCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width: W, height: H } = canvas;
  if (W < 1 || H < 1) return canvas;
  const image = ctx.getImageData(0, 0, W, H);
  const src = image.data;
  const blur = gaussianBlurRGBA(src, W, H);
  // addWeighted(src, 1 + amount, blur, -amount, 0)
  const gain = 1 + UNSHARP_AMOUNT;
  for (let i = 0; i < src.length; i += 4) {
    src[i] = src[i]! * gain - blur[i]! * UNSHARP_AMOUNT;
    src[i + 1] = src[i + 1]! * gain - blur[i + 1]! * UNSHARP_AMOUNT;
    src[i + 2] = src[i + 2]! * gain - blur[i + 2]! * UNSHARP_AMOUNT;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Decodifica un blob a canvas (para post-proceso del encode del worker). */
async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bm = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bm.width;
  canvas.height = bm.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bm, 0, 0);
  bm.close();
  return canvas;
}

// ─── Detección de bordes ────────────────────────────────────────────────────

/**
 * Detección de bordes del documento — PIPELINE REAL del usuario
 * (contornos OpenCV + selección por score). Fallback: Sobel local.
 */
export async function detectDocumentEdges(src: ImageSource): Promise<Quad> {
  // 1) Pipeline real: worker + OpenCV.js
  const quad = await detectWithWorker(src);
  if (quad) return quad;
  // 2) Fallback: Sobel simplificado (siempre devuelve algo)
  return detectSobel(src);
}

async function detectWithWorker(src: ImageSource): Promise<Quad | null> {
  const client = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    const img = await ensureDecoded(src);
    const w = sourceWidth(img);
    const h = sourceHeight(img);
    if (!w || !h) return null;
    const out = await client.detect(img, w, h);
    if (out && isValidQuadFloats(out.corners)) {
      const quad = floatsToQuad(out.corners);
      // Sanity: área razonable (el worker ya valida ≥10% del frame)
      const area = quadArea(quad);
      if (area > 0.01) return quad;
    }
  } catch {
    /* fallback */
  }
  return null;
}

function quadArea(q: Quad): number {
  const [tl, tr, br, bl] = q;
  const tri = (a: Point, b: Point, c: Point) =>
    Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  return tri(tl!, tr!, br!) + tri(tl!, br!, bl!);
}

/** Sobel simplificado sobre downscaled (fallback del pipeline real). */
async function detectSobel(src: ImageSource): Promise<Quad> {
  try {
    const img = await ensureDecoded(src);
    const w0 = sourceWidth(img);
    const h0 = sourceHeight(img);
    const W = 160;
    const H = Math.max(1, Math.round((h0 / w0) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.drawImage(img, 0, 0, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;

    // Mapa de energía Sobel
    const energy = new Float32Array(W * H);
    const gray = (i: number) =>
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx =
          -gray(i - W - 1) - 2 * gray(i - 1) - gray(i + W - 1) +
          gray(i - W + 1) + 2 * gray(i + 1) + gray(i + W + 1);
        const gy =
          -gray(i - W - 1) - 2 * gray(i - W) - gray(i - W + 1) +
          gray(i + W - 1) + 2 * gray(i + W) + gray(i + W + 1);
        energy[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }

    const findEdgeX = (from: number, to: number, y0: number, y1: number) => {
      let bestX = from;
      let bestE = -1;
      for (let x = from; x < to; x++) {
        let e = 0;
        for (let y = y0; y < y1; y++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestX = x;
        }
      }
      return bestX / W;
    };
    const findEdgeY = (from: number, to: number, x0: number, x1: number) => {
      let bestY = from;
      let bestE = -1;
      for (let y = from; y < to; y++) {
        let e = 0;
        for (let x = x0; x < x1; x++) e += energy[y * W + x];
        if (e > bestE) {
          bestE = e;
          bestY = y;
        }
      }
      return bestY / H;
    };

    const m = Math.round(W * 0.06);
    const left = findEdgeX(1, Math.floor(W * 0.45), m, H - m);
    const right = findEdgeX(Math.ceil(W * 0.55), W - 1, m, H - m);
    const top = findEdgeY(1, Math.floor(H * 0.45), m, W - m);
    const bottom = findEdgeY(Math.ceil(H * 0.55), H - 1, m, W - m);

    return [
      { x: clamp01(left), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(top) },
      { x: clamp01(right), y: clamp01(bottom) },
      { x: clamp01(left), y: clamp01(bottom) },
    ];
  } catch {
    return [
      { x: 0.08, y: 0.1 },
      { x: 0.92, y: 0.07 },
      { x: 0.95, y: 0.93 },
      { x: 0.05, y: 0.96 },
    ];
  }
}

function clamp01(v: number) {
  return Math.min(0.98, Math.max(0.02, v));
}

// ─── Filtros canvas (fallback del enhance real) ─────────────────────────────

/**
 * Resuelve la homografía (DLT 4 puntos, eliminación gaussiana con pivoteo)
 * que mapea el rect DESTINO → quad FUENTE. Devuelve h[9] (h[8]=1) o null
 * si el sistema es degenerado (quad con 3 puntos colineales, p. ej.).
 */
function solveHomographyDstToSrc(
  dst: ReadonlyArray<readonly [number, number]>,
  src: ReadonlyArray<readonly [number, number]>
): number[] | null {
  const n = 8;
  const M: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [X, Y] = dst[i]!;
    const [u, v] = src[i]!;
    M.push([X, Y, 1, 0, 0, 0, -X * u, -Y * u, u]);
    M.push([0, 0, 0, X, Y, 1, -X * v, -Y * v, v]);
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    if (Math.abs(M[piv]![col]!) < 1e-12) return null;
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / M[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  const h = new Array<number>(9).fill(0);
  for (let i = 0; i < n; i++) h[i] = M[i]![n]! / M[i]![i]!;
  h[8] = 1;
  return h;
}

/**
 * Rectifica el quad por homografía + muestreo BILINEAL (fallback canvas
 * del warpPerspective INTER_CUBIC del worker — F6-WARP).
 *
 * Dimensiones de salida con aspecto MEDIDO (§7.5):
 *   w0 = max(|TL->TR|, |BL->BR|);  h0 = max(|TR->BR|, |TL->BL|)
 *   escala uniforme SOLO si max(w0,h0) > maxSize — PROHIBIDO upscalar (R-02).
 *
 * Devuelve null si la homografía no se puede resolver → el llamador cae al
 * recorte bbox (último recurso). El quad manual se respeta al píxel (R-09):
 * sin refine, sin shrink — aquí no hay refinado de ninguna clase.
 */
function warpQuadToCanvas(
  img: HTMLImageElement,
  quad: Quad,
  maxSize: number
): HTMLCanvasElement | null {
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!(sw > 0) || !(sh > 0)) return null;

  // Quad en píxeles de la fuente (orden TL, TR, BR, BL).
  const pts = quad.map((p) => ({ x: p.x * sw, y: p.y * sh })) as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y);
  const w0 = Math.max(dist(pts[0]!, pts[1]!), dist(pts[3]!, pts[2]!));
  const h0 = Math.max(dist(pts[1]!, pts[2]!), dist(pts[0]!, pts[3]!));
  if (!(w0 > 1) || !(h0 > 1)) return null;

  const scale = Math.min(1, maxSize / Math.max(w0, h0)); // nunca upscalar
  const w = Math.max(16, Math.round(w0 * scale));
  const h = Math.max(16, Math.round(h0 * scale));

  // H mapea (X,Y) del rect destino → (u,v) en la fuente.
  const H = solveHomographyDstToSrc(
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ],
    [
      [pts[0]!.x, pts[0]!.y],
      [pts[1]!.x, pts[1]!.y],
      [pts[2]!.x, pts[2]!.y],
      [pts[3]!.x, pts[3]!.y],
    ]
  );
  if (!H) return null;
  const h0c = H[0]!;
  const h1c = H[1]!;
  const h2c = H[2]!;
  const h3c = H[3]!;
  const h4c = H[4]!;
  const h5c = H[5]!;
  const h6c = H[6]!;
  const h7c = H[7]!;

  // Píxeles de la fuente a resolución completa (R-02: la foto es la fuente).
  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = sw;
  srcCanvas.height = sh;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!sctx) return null;
  sctx.drawImage(img, 0, 0);
  const srcData = sctx.getImageData(0, 0, sw, sh).data;

  const outCanvas = document.createElement("canvas");
  outCanvas.width = w;
  outCanvas.height = h;
  const octx = outCanvas.getContext("2d", { willReadFrequently: true });
  if (!octx) return null;
  const outImage = octx.createImageData(w, h);
  const out = outImage.data;

  const maxX = sw - 1;
  const maxY = sh - 1;
  for (let y = 0; y < h; y++) {
    // Centros de píxel — muestreo simétrico con el warp del worker.
    const Y = y + 0.5;
    for (let x = 0; x < w; x++) {
      const X = x + 0.5;
      const den = h6c * X + h7c * Y + 1;
      if (den === 0) continue;
      let u = (h0c * X + h1c * Y + h2c) / den;
      let v = (h3c * X + h4c * Y + h5c) / den;
      // Edge-replicate (el quad puede rozar el borde de la foto).
      if (u < 0) u = 0;
      else if (u > maxX) u = maxX;
      if (v < 0) v = 0;
      else if (v > maxY) v = maxY;
      // Bilinear
      const x0 = u | 0;
      const y0 = v | 0;
      const x1 = x0 < maxX ? x0 + 1 : x0;
      const y1 = y0 < maxY ? y0 + 1 : y0;
      const fx = u - x0;
      const fy = v - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        out[o + c] =
          srcData[i00 + c]! * w00 +
          srcData[i10 + c]! * w10 +
          srcData[i01 + c]! * w01 +
          srcData[i11 + c]! * w11;
      }
      out[o + 3] = 255;
    }
  }
  octx.putImageData(outImage, 0, 0);
  return outCanvas;
}

/** ÚLTIMO recurso del fallback: recorte bbox del quad + rotación (sin
 *  homografía). Solo si warpQuadToCanvas no pudo resolver el sistema. */
async function cropQuad(
  img: HTMLImageElement,
  quad: Quad,
  rotation: number,
  maxSize: number
): Promise<HTMLCanvasElement> {
  const xs = quad.map((p) => p.x * img.width);
  const ys = quad.map((p) => p.y * img.height);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const w = Math.max(16, right - left);
  const h = Math.max(16, bottom - top);
  const scale = Math.min(1, maxSize / Math.max(w, h));

  const swapped = rotation === 90 || rotation === 270;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(swapped ? h * scale : w * scale);
  canvas.height = Math.round(swapped ? w * scale : h * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sin contexto");
  ctx.imageSmoothingQuality = "high";
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  // La rotación ya intercambia los ejes para 90/270 — el scale debe ser
  // uniforme (el `-scale` anterior ESPEJABA la imagen en rotaciones 90/270,
  // bug E6 del fallback canvas).
  ctx.scale(scale, scale);
  ctx.drawImage(img, -left, -top, w, h, -w / 2, -h / 2, w, h);
  ctx.restore();
  return canvas;
}

/**
 * Aplica el filtro a una imagen ya rectificada — fallback canvas con la
 * MISMA matemática del motor (contrato §4.2: funciones puras COMPARTIDAS de
 * image-modes.ts; PROHIBIDO Otsu global u otra matemática — error #7).
 * Unsharp (0.5/1.5/k7) ANTES del filtro en todo modo ≠ raw/text (§8):
 * "text" afila por bordes internamente (edgeAwareSharpenGray) — F-TEXT-CLEAN.
 */
export function applyFilterToCanvas(
  canvas: HTMLCanvasElement,
  filter: PageFilter
): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { width: W, height: H } = canvas;
  if (W < 1 || H < 1) return canvas;
  const mode = filterToSharedMode(filter);
  const image = ctx.getImageData(0, 0, W, H);
  let d: Uint8ClampedArray = image.data;
  if (mode !== "raw" && mode !== "text") {
    d = unsharpRgba(d, W, H); // §8: unsharp ANTES del filtro, mode ≠ raw/text
  }
  const out = enhanceToRgba(d, W, H, mode);
  const dest = ctx.createImageData(W, H);
  dest.data.set(out);
  ctx.putImageData(dest, 0, 0);
  return canvas;
}

// ─── Pipeline principal ─────────────────────────────────────────────────────

/**
 * Pipeline completo: rectifica (warp real) → rota → realza (modo real) →
 * devuelve processed + thumbnail. Fallback: recorte canvas + filtro local.
 */
export async function processImage(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation = 0,
  opts?: ProcessOptions
): Promise<ProcessResult> {
  const precise = await processImagePrecise(src, quad, filter, rotation, opts);
  if (precise) return precise;
  return processImageCanvas(src, quad, filter, rotation, opts);
}

/** Nº de esquinas firmes del refinado (fellBack[i]=true ⇒ esquina i cayó al
 *  estimado grueso). null cuando el worker no informa (quad manual). */
function solidCorners(fellBack: readonly boolean[] | null): number | null {
  if (!fellBack) return null;
  return fellBack.filter((f) => !f).length;
}

/** Pipeline REAL vía DetectionWorker. null → el llamador usa su fallback. */
async function processImagePrecise(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation: number,
  opts?: ProcessOptions
): Promise<ProcessResult | null> {
  const client: ScannerWorkerClient | null = getScannerWorker();
  if (!client || client.isDead) return null;
  const ok = await client.waitReady();
  if (!ok) return null;
  try {
    const img = await loadImage(src);
    if (!img.naturalWidth || !img.naturalHeight) return null;

    // 1) Warp: refinado sub-píxel (RANSAC) + shrink 3.5px + homografía
    //    INTER_CUBIC sobre la FOTO completa (la foto es la fuente de verdad).
    //    El worker cierra el bitmap de entrada y devuelve uno nuevo (puro,
    //    sin unsharp horneado — F5-RAW-2).
    const warp = await client.warp(img, quad, opts?.manual === true);
    if (!warp || !warp.bitmap) return null;

    // 2) Rotación post-warp (90/180/270) en canvas de alta calidad.
    const rotated = bitmapToRotatedCanvas(warp.bitmap, rotation);
    warp.bitmap.close();

    // 3) Enhance: modo real del producto (modelo de sombras + constantes
    //    exactas). maxLongSide protege la memoria de data URLs en iOS.
    const mode = filterToEnhanceMode(filter);
    const maxLongSide = opts?.maxLongSide ?? PROCESSED_MAX_LONG_SIDE;
    const enh = await client.enhance(rotated, mode, { maxLongSide });

    if (enh && enh.blob.size > 0) {
      let blob = enh.blob;
      // Toggle de nitidez para el Original: el modo raw sale PURO del worker
      // (F5-RAW) — el unsharp se aplica aquí, en cliente, con las mismas
      // constantes del producto (0.5/1.5, kernel 7).
      if (filter === "original" && opts?.unsharpOriginal === true) {
        try {
          const canvas = applyUnsharpToCanvas(await blobToCanvas(blob));
          const reencoded = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/png")
          );
          if (reencoded && reencoded.size > 0) blob = reencoded;
        } catch {
          /* conserva el blob puro */
        }
      }
      const processed = await blobToDataURL(blob);
      const thumbnail = await thumbnailFromBlob(blob);
      const precision: PagePrecision = {
        engine: "worker",
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: enh.w,
        height: enh.h,
        elapsedMs: enh.elapsedMs,
      };
      if (thumbnail) return { processed, thumbnail, precision };
      // Sin thumbnail desde el blob → lo genero del canvas rotado
      return {
        processed,
        thumbnail: thumbnailFromCanvas(rotated),
        precision,
      };
    }

    // 4) Enhance no disponible → warp real + filtro canvas local (misma
    //    matemática de image-modes). Los 3 filtros salen PNG (R-10).
    const filtered = applyFilterToCanvas(rotated, filter);
    if (filter === "original" && opts?.unsharpOriginal === true) {
      applyUnsharpToCanvas(filtered);
    }
    const processed = await canvasToDataURL(filtered, "image/png");
    return {
      processed,
      thumbnail: thumbnailFromCanvas(filtered),
      precision: {
        engine: "worker",
        refined: warp.refined,
        cornersSolid: solidCorners(warp.fellBack),
        width: filtered.width,
        height: filtered.height,
      },
    };
  } catch {
    return null;
  }
}

function thumbnailFromCanvas(canvas: HTMLCanvasElement): string {
  const tW = 160;
  const tH = Math.max(1, Math.round((canvas.height / canvas.width) * tW));
  const tCanvas = document.createElement("canvas");
  tCanvas.width = tW;
  tCanvas.height = tH;
  const tCtx = tCanvas.getContext("2d");
  if (tCtx) {
    tCtx.imageSmoothingQuality = "high";
    tCtx.drawImage(canvas, 0, 0, tW, tH);
  }
  return tCanvas.toDataURL("image/jpeg", 0.8);
}

/** Encode de canvas grande vía toBlob (error #22: toDataURL sobre canvas
 *  grande revienta memoria en Safari/iOS). Caída a toDataURL si falla. */
function canvasToDataURL(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number
): Promise<string> {
  return new Promise<string>((resolve) => {
    try {
      canvas.toBlob(
        (b) => {
          if (!b || b.size === 0) {
            resolve(canvas.toDataURL(mime, quality));
            return;
          }
          blobToDataURL(b)
            .then(resolve)
            .catch(() => resolve(canvas.toDataURL(mime, quality)));
        },
        mime,
        quality
      );
    } catch {
      resolve(canvas.toDataURL(mime, quality));
    }
  });
}

/**
 * Pipeline canvas local (fallback) — F6-WARP/F6-FILTER:
 *  1. Warp de perspectiva real (homografía + bilinear, aspecto medido §7.5,
 *     cap PROCESSED_MAX_LONG_SIDE, nunca upscala) — no el recorte bbox.
 *  2. Rotación post-warp (90/180/270) de alta calidad.
 *  3. Filtro con la MISMA matemática del motor (image-modes) + PNG (R-10).
 */
async function processImageCanvas(
  src: string,
  quad: Quad,
  filter: PageFilter,
  rotation: number,
  opts?: ProcessOptions
): Promise<ProcessResult> {
  const img = await loadImage(src);
  const maxLongSide = opts?.maxLongSide ?? PROCESSED_MAX_LONG_SIDE;
  const warped = warpQuadToCanvas(img, quad, maxLongSide);
  const base =
    warped !== null
      ? bitmapToRotatedCanvas(warped, rotation)
      : await cropQuad(img, quad, rotation, maxLongSide); // último recurso bbox
  const filtered = applyFilterToCanvas(base, filter);
  if (filter === "original" && opts?.unsharpOriginal === true) {
    applyUnsharpToCanvas(filtered);
  }
  // Los 3 filtros del producto salen PNG (R-10) — sin ringing sobre tinta.
  const processed = await canvasToDataURL(filtered, "image/png");
  return {
    processed,
    thumbnail: thumbnailFromCanvas(filtered),
    precision: {
      engine: "canvas",
      refined: false,
      cornersSolid: null,
      width: filtered.width,
      height: filtered.height,
    },
  };
}

/** Evaluación de calidad de la página (Laplaciano + contraste + brillo). */
export async function evaluateQuality(src: ImageSource): Promise<PageQuality> {
  try {
    const img = await ensureDecoded(src);
    const w0 = sourceWidth(img);
    const h0 = sourceHeight(img);
    const W = 120;
    const H = Math.max(1, Math.round((h0 / w0) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("sin contexto");
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;

    const gray = new Float32Array(W * H);
    let sum = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      gray[j] = l;
      sum += l;
    }
    const mean = sum / gray.length;

    let lapSum = 0;
    let lapSq = 0;
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - W] - gray[i + W];
        lapSum += lap;
        lapSq += lap * lap;
      }
    }
    const n = (W - 2) * (H - 2);
    const variance = lapSq / n - (lapSum / n) * (lapSum / n);
    const sharpness = Math.min(100, Math.round(Math.sqrt(variance) * 2.2));

    let sqDiff = 0;
    for (let j = 0; j < gray.length; j++) sqDiff += (gray[j] - mean) * (gray[j] - mean);
    const contrast = Math.min(100, Math.round(Math.sqrt(sqDiff / gray.length) * 1.4));

    const brightness = Math.min(100, Math.round((mean / 255) * 100));

    const score = sharpness * 0.45 + brightness * 0.25 + contrast * 0.3;
    const level = score >= 80 ? "excellent" : score >= 62 ? "good" : score >= 45 ? "fair" : "poor";
    const label =
      level === "excellent" ? "Excelente" : level === "good" ? "Buena" : level === "fair" ? "Aceptable" : "Baja";
    return { level, sharpness, brightness, contrast, label };
  } catch {
    return {
      level: "good",
      sharpness: 70,
      brightness: 70,
      contrast: 70,
      label: "Buena",
    };
  }
}

/** Genera una imagen de página de demo (factura) como data URL.
 *  Se renderiza a 3× (1920×2580) — resolución de cámara real: las capturas
 *  de demo/simulado ejercitan el pipeline completo (detect→warp→enhance)
 *  con calidad de sensor, no de preview VGA. */
export function generateDemoPage(seed = 1): string {
  const SCALE = 3;
  const W = 640;
  const H = 860;
  const canvas = document.createElement("canvas");
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(SCALE, SCALE);
  // Fondo papel
  ctx.fillStyle = "#f7f4ec";
  ctx.fillRect(0, 0, W, H);
  // Sombra leve
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  ctx.fillRect(12, 12, W - 24, H - 24);

  // Encabezado
  ctx.fillStyle = "#1c1c1e";
  ctx.font = "bold 26px -apple-system, sans-serif";
  ctx.fillText("GLOBAL SYNERGY LTD.", 40, 70);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "14px -apple-system, sans-serif";
  ctx.fillText(`FACTURA #GSS-2026-04${seed}1`, 40, 96);
  ctx.fillText("26 October, 2026", 40, 118);

  // Tabla
  let y = 190;
  ctx.fillStyle = "#8e8e93";
  ctx.font = "600 12px -apple-system, sans-serif";
  ctx.fillText("CONCEPTO", 40, y);
  ctx.fillText("CANT.", 400, y);
  ctx.fillText("SUBTOTAL", 500, y);
  ctx.strokeStyle = "#e5e5ea";
  ctx.beginPath();
  ctx.moveTo(40, y + 10);
  ctx.lineTo(W - 40, y + 10);
  ctx.stroke();

  const rows = [
    ["Consultoría Estratégica", "1", "€3,500.00"],
    ["Licencias Software Anual", "1", "€3,600.00"],
    ["Dirección de Proyecto GSS", "1", "€3,600.00"],
  ];
  ctx.font = "15px -apple-system, sans-serif";
  rows.forEach((r, i) => {
    const ry = y + 44 + i * 40;
    ctx.fillStyle = "#1c1c1e";
    ctx.fillText(r[0], 40, ry);
    ctx.fillText(r[1], 405, ry);
    ctx.fillText(r[2], 500, ry);
    ctx.strokeStyle = "#ececf0";
    ctx.beginPath();
    ctx.moveTo(40, ry + 14);
    ctx.lineTo(W - 40, ry + 14);
    ctx.stroke();
  });

  // Total
  ctx.fillStyle = "#3c3c43";
  ctx.font = "600 13px -apple-system, sans-serif";
  ctx.fillText("TOTAL A PAGAR", 40, y + 200);
  ctx.fillStyle = "#007aff";
  ctx.font = "bold 30px -apple-system, sans-serif";
  ctx.fillText("€16,800.00", W - 240, y + 205);

  // Sello
  ctx.save();
  ctx.translate(120, H - 140);
  ctx.rotate(-0.22);
  ctx.strokeStyle = "rgba(255,59,48,0.75)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 190, 54);
  ctx.fillStyle = "rgba(255,59,48,0.8)";
  ctx.font = "bold 16px -apple-system, sans-serif";
  ctx.fillText("PAID · OCT 26", 22, 34);
  ctx.restore();

  ctx.save();
  ctx.translate(W - 320, H - 190);
  ctx.rotate(0.12);
  ctx.strokeStyle = "rgba(0,122,255,0.6)";
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 210, 54);
  ctx.fillStyle = "rgba(0,122,255,0.7)";
  ctx.font = "bold 15px -apple-system, sans-serif";
  ctx.fillText("RECEIVED", 55, 34);
  ctx.restore();

  // Firma
  ctx.fillStyle = "#3c3c43";
  ctx.font = "italic 20px Georgia, serif";
  ctx.fillText("Sarah Jenkins", W - 260, H - 80);
  ctx.fillStyle = "#8e8e93";
  ctx.font = "11px -apple-system, sans-serif";
  ctx.fillText("Director · 26/10/2026", W - 260, H - 60);

  return canvas.toDataURL("image/jpeg", 0.92);
}
