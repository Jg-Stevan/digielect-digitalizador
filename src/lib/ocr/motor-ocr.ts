"use client";

// ============================================================
// OCR DE RUTEO E-14 — Motor (tesseract local, offline estricto)
// ============================================================
// Worker propio de tesseract.js (v5, vendrorizado) SOLO en español,
// precalentable en idle durante la captura. Por zona: recorte del
// bitmap (canvas offscreen) → recognize con whitelist + modo línea →
// {valor, confianza}. Canvas liberado tras cada recorte (R-14).
//
// Invariante 6: CERO CDNs. Los binarios viven en public/ocr/** y
// el Service Worker los cachea. Si el vendor falta → null (fallo
// suave: el flujo continúa sin sugerencia de ruteo).
//
// ── PLAN DE MEJORA v1.1 (plan-mejora-deteccion-actas.md) ─────
// · T1 — Decodificar el bitmap UNA sola vez: antes recortarZona()
//   re-decodificaba el JPEG por cada zona (5 zonas = 5 decodifica-
//   ciones) y quemaba el presupuesto de 5 s. Ahora el dataURL se
//   decodifica 1× a ImageBitmap y TODAS las zonas se recortan desde
//   él (bmp.close() al final; canvas liberado por zona).
// · T2 — Orden de lectura mesa→puesto→zona→municipio→departamento
//   (ORDEN_LECTURA_RUTEO): el presupuesto se gasta primero donde
//   el feedback del jurado importa más.
// · T3 — Ensemble con early-exit por zona:
//     A) recorte tal cual + PSM 7  (pasada primaria, siempre)
//     B) estiramiento de contraste (p85→blanco) + PSM 7
//     C) b/n Bradley adaptativo ×2.5 + PSM 8
//   B y C SOLO corren si A no pasa la validez estructural (early
//   exit — CPU solo cuando hace falta). Si ≥2 variantes pasan y
//   discrepan → votación por posición de dígito ponderada por la
//   confianza de Tesseract; empate → gana la de mayor confianza y
//   el campo queda marcado nota "multivariante-discrepan".
// · T4/F1.5 — Soporte de pistas impresas: reconocerPistas() lee la
//   línea del barcode impreso (d15 + "Ver/Pag"), el footer
//   (KIT/Civ/No. Form) y el banner del ejemplar con pasada
//   INVERTIDA (blanco-sobre-negro) sobre la banda oscura detectada
//   por densidad de píxeles en el tercio superior central.
// · T6/F3 — Localización adaptativa de cajas: antes de recortar
//   cada zona de ruteo se busca la caja impresa dentro de una
//   ventana ±8% alrededor de la caja calibrada (perfiles de
//   densidad de tinta → bordes del rectángulo impreso). Si hay
//   exactamente 1 caja plausible se centra el recorte en ella; si
//   no → caja fija calibrada (fail-safe actual intacto).
// ============================================================

import { withBasePath } from "@/lib/env";
import type { CampoOcr } from "@/lib/contrato/types";
import { ORDEN_LECTURA_RUTEO, type ZonaOcr } from "./zonas-e14";

const TESS = "/ocr/tesseract";
const TESSDATA = "/ocr/tessdata";
/** Presupuesto total del OCR de ruteo (puerta Fase 5: ≤5 s gama media). */
const PRESUPUESTO_MS = 5_000;
/** Escala del recorte para el recognize (los dígitos impresos son pequeños). */
const ESCALA_RECORTE = 3;
/** Escala máxima del recorte (lado mayor en px del canvas de pasada A/B). */
const LADO_MAX_RECORTE = 600;
/** [T3-C] Escala adicional de la variante C (b/n Bradley). */
const ESCALA_VARIANTE_C = 2.5;
/** [T3] Tope por zona para seguir encadenando variantes B/C (early-exit). */
const TOPE_VARIANTES_MS = 1_500;
/** [T6] Ventana de búsqueda de la caja impresa (±8% del acta). */
const MARGEN_CAJA = 0.08;

interface TesseractWorkerLike {
  recognize: (
    img: string | HTMLCanvasElement | OffscreenCanvas
  ) => Promise<{ data: { text: string; confidence: number } }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
}

interface TesseractLike {
  createWorker: (
    langs: string[],
    oem?: number,
    opts?: Record<string, unknown>
  ) => Promise<TesseractWorkerLike>;
}

let workerProm: Promise<TesseractWorkerLike | null> | null = null;

/** Inyecta el UMD local de tesseract.js (una sola vez). Sin CDN. */
function inyectarTesseract(): Promise<TesseractLike | null> {
  return new Promise((resolve) => {
    try {
      const w = window as unknown as { Tesseract?: TesseractLike };
      if (w.Tesseract) {
        resolve(w.Tesseract);
        return;
      }
      const script = document.createElement("script");
      script.src = withBasePath(`${TESS}/tesseract.min.js`);
      script.async = true;
      script.onload = () => resolve(w.Tesseract ?? null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Worker singleton de OCR de ruteo (spa). Precalentable en idle:
 * la primera llamada paga el arranque (~1-2 s); las siguientes
 * reconocen en serie sobre el worker vivo.
 */
export function workerOcrRuteo(): Promise<TesseractWorkerLike | null> {
  if (workerProm) return workerProm;
  workerProm = (async () => {
    const T = await inyectarTesseract();
    if (!T) return null;
    try {
      return await T.createWorker(["spa"], 1, {
        workerPath: withBasePath(`${TESS}/worker.min.js`),
        corePath: withBasePath(`${TESS}/core`),
        langPath: withBasePath(TESSDATA),
        gzip: true,
      });
    } catch {
      return null;
    }
  })();
  return workerProm;
}

/** Precalienta el motor en idle (llamar al montar la captura). */
export function precalentarOcrRuteo(): void {
  void workerOcrRuteo();
}

function liberarCanvas(c: HTMLCanvasElement): void {
  // R-14: soltar el backing store YA, no esperar al GC
  c.width = 0;
  c.height = 0;
}

// ------------------------------------------------------------
// [T1] Decodificación ÚNICA del bitmap
// ------------------------------------------------------------

/** Crea el canvas de recorte (escala) desde una región del bitmap. */
function recorteDesdeBitmap(
  bmp: ImageBitmap,
  box: [number, number, number, number],
  ladoMax: number,
  escalaExtra = 1
): HTMLCanvasElement | null {
  const [x, y, w, h] = box;
  const sx = Math.max(0, Math.round(x * bmp.width));
  const sy = Math.max(0, Math.round(y * bmp.height));
  const sw = Math.max(8, Math.min(bmp.width - sx, Math.round(w * bmp.width)));
  const sh = Math.max(8, Math.min(bmp.height - sy, Math.round(h * bmp.height)));
  const escala =
    Math.min(ESCALA_RECORTE, Math.max(1, ladoMax / Math.max(sw, sh))) * escalaExtra;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(8, Math.round(sw * escala));
  canvas.height = Math.max(8, Math.round(sh * escala));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    liberarCanvas(canvas);
    return null;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// ------------------------------------------------------------
// [T3] Variantes de pre-procesamiento del recorte
// ------------------------------------------------------------

/** Gris 8-bit de un canvas (Uint8ClampedArray RGBA → luminancia). */
function grisDe(canvas: HTMLCanvasElement): { gris: Uint8ClampedArray; w: number; h: number } | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const n = w * h;
  const gris = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    gris[i] = (0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2]) | 0;
  }
  return { gris, w, h };
}

/** [Variante B] Estiramiento de contraste: percentil 85 → blanco
 *  (misma idea del filtro "texto" del escáner). Modifica el canvas. */
function estirarContraste(canvas: HTMLCanvasElement): void {
  const g = grisDe(canvas);
  if (!g) return;
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.gris.length; i++) hist[g.gris[i]]++;
  const total = g.gris.length;
  // p2 → negro, p85 → blanco (impresión débil sube el p85)
  const percentil = (p: number): number => {
    const objetivo = total * p;
    let acum = 0;
    for (let v = 0; v < 256; v++) {
      acum += hist[v];
      if (acum >= objetivo) return v;
    }
    return 255;
  };
  const p2 = percentil(0.02);
  const p85 = percentil(0.85);
  const rango = Math.max(1, p85 - p2);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, g.w, g.h);
  for (let i = 0; i < g.gris.length; i++) {
    const v = Math.max(0, Math.min(255, ((g.gris[i] - p2) * 255) / rango));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** [Variante C] Binarización adaptativa Bradley (umbral local por
 *  ventana — robusto a sombras) sobre el canvas. */
function bradleyBinarizar(canvas: HTMLCanvasElement, t = 0.15): void {
  const g = grisDe(canvas);
  if (!g) return;
  const { gris, w, h } = g;
  // Imagen integral (Uint64 simulado con Number — áreas pequeñas, ok)
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sumaFila = 0;
    for (let x = 0; x < w; x++) {
      sumaFila += gris[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + sumaFila;
    }
  }
  const ladoVentana = Math.max(8, Math.floor(Math.min(w, h) / 8));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - ladoVentana);
    const y1 = Math.min(h - 1, y + ladoVentana);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - ladoVentana);
      const x1 = Math.min(w - 1, x + ladoVentana);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const suma =
        integral[(y1 + 1) * (w + 1) + (x1 + 1)] -
        integral[y0 * (w + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (w + 1) + x0] +
        integral[y0 * (w + 1) + x0];
      const v = gris[y * w + x] < suma / area * (1 - t) ? 0 : 255;
      img.data[y * w * 4 + x * 4] = v;
      img.data[y * w * 4 + x * 4 + 1] = v;
      img.data[y * w * 4 + x * 4 + 2] = v;
      img.data[y * w * 4 + x * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** [T4] Inversión de un canvas (blanco-sobre-negro → negro-sobre-blanco). */
function invertirCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 255 - img.data[i];
    img.data[i + 1] = 255 - img.data[i + 1];
    img.data[i + 2] = 255 - img.data[i + 2];
  }
  ctx.putImageData(img, 0, 0);
}

// ------------------------------------------------------------
// [T3] Ensemble: validez estructural + votación por dígito
// ------------------------------------------------------------

/** Validez estructural: SOLO dígitos y cantidad exacta (zonas de ruteo). */
function pasaEstructural(valor: string, digitos: number): boolean {
  if (!valor) return false;
  return /^\d+$/.test(valor) && valor.length === digitos;
}

interface LecturaVariante {
  valor: string;
  confianza: number;
  variante: "A" | "B" | "C";
}

/**
 * Votación por posición de dígito ponderada por confianza (T3).
 * Las lecturas llegan ya validadas estructuralmente (misma longitud).
 * Empate total → gana la de MAYOR confianza (con nota discrepancy).
 */
function votarPorDigito(
  lecturas: LecturaVariante[]
): { valor: string; discrepancia: boolean } | null {
  if (lecturas.length === 0) return null;
  if (lecturas.length === 1) return { valor: lecturas[0].valor, discrepancia: false };
  const todosIguales = lecturas.every((l) => l.valor === lecturas[0].valor);
  if (todosIguales) {
    return {
      valor: lecturas.reduce((a, b) => (b.confianza > a.confianza ? b : a)).valor,
      discrepancia: false,
    };
  }
  const longitud = lecturas[0].valor.length;
  if (lecturas.some((l) => l.valor.length !== longitud)) {
    // longitudes distintas: la de mayor confianza manda
    return { valor: lecturas.reduce((a, b) => (b.confianza > a.confianza ? b : a)).valor, discrepancia: true };
  }
  let out = "";
  for (let i = 0; i < longitud; i++) {
    const peso: Record<string, number> = {};
    for (const l of lecturas) {
      peso[l.valor[i]] = (peso[l.valor[i]] ?? 0) + l.confianza;
    }
    let mejor = lecturas[0].valor[i];
    let mejorPeso = -1;
    for (const [d, p] of Object.entries(peso)) {
      if (p > mejorPeso || (p === mejorPeso && d === lecturas[0].valor[i])) {
        mejor = d;
        mejorPeso = p;
      }
    }
    out += mejor;
  }
  return { valor: out, discrepancia: true };
}

// ------------------------------------------------------------
// [T6] Localización adaptativa de la caja impresa
// ------------------------------------------------------------

/**
 * Busca la caja impresa dentro de una ventana ±8% alrededor de la
 * caja calibrada. Método (barato y determinista): la caja impresa
 * es un RECTÁNGULO con bordes fuertes → perfiles de densidad de
 * tinta por fila/columna sobre la ventana en gris+b/n; los bordes
 * son las filas/columnas con densidad extrema. Devuelve el
 * rectángulo detectado en fracciones, o null si no hay UNA caja
 * plausible (→ el llamador usa la caja fija calibrada: fail-safe).
 */
export function localizarCajaImpresa(
  bmp: ImageBitmap,
  box: [number, number, number, number]
): [number, number, number, number] | null {
  try {
    // Ventana ±8% del acta (más margen vertical relativo: el warp leve
    // desplaza más en Y al escanear con perspectiva).
    const mx = MARGEN_CAJA;
    const my = MARGEN_CAJA * 0.75;
    const wx = Math.max(0, box[0] - mx);
    const wy = Math.max(0, box[1] - my);
    const ww = Math.min(1 - wx, box[2] + 2 * mx);
    const wh = Math.min(1 - wy, box[3] + 2 * my);
    const sx = Math.round(wx * bmp.width);
    const sy = Math.round(wy * bmp.height);
    const sw = Math.max(8, Math.round(ww * bmp.width));
    const sh = Math.max(8, Math.round(wh * bmp.height));

    // Ventana pequeña: solo perfiles (rápido incluso en gama baja)
    const W = 220;
    const escala = W / sw;
    const H = Math.max(8, Math.round(sh * escala));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      liberarCanvas(canvas);
      return null;
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    const g = grisDe(canvas);
    liberarCanvas(canvas);
    if (!g) return null;

    // B/N por umbral global de la ventana (tinta oscura)
    let suma = 0;
    for (let i = 0; i < g.gris.length; i++) suma += g.gris[i];
    const media = suma / g.gris.length;
    const umbral = media * 0.72;
    const oscuro = (x: number, y: number): boolean => g.gris[y * g.w + x] < umbral;

    // Perfil por fila → bordes horizontales (densidad alta en toda la caja)
    const densFila = new Float32Array(g.h);
    for (let y = 0; y < g.h; y++) {
      let n = 0;
      for (let x = 0; x < g.w; x++) if (oscuro(x, y)) n++;
      densFila[y] = n / g.w;
    }
    const umbralFila = 0.5;
    let yTop = -1;
    let yBot = -1;
    for (let y = 0; y < g.h; y++) {
      if (densFila[y] >= umbralFila) {
        if (yTop < 0) yTop = y;
        yBot = y;
      }
    }
    if (yTop < 0 || yBot - yTop < 3) return null;

    // Perfil por columna dentro de la banda → bordes verticales
    const densCol = new Float32Array(g.w);
    for (let x = 0; x < g.w; x++) {
      let n = 0;
      for (let y = yTop; y <= yBot; y++) if (oscuro(x, y)) n++;
      densCol[x] = n / (yBot - yTop + 1);
    }
    const umbralCol = 0.5;
    let xIzq = -1;
    let xDer = -1;
    for (let x = 0; x < g.w; x++) {
      if (densCol[x] >= umbralCol) {
        if (xIzq < 0) xIzq = x;
        xDer = x;
      }
    }
    if (xIzq < 0 || xDer - xIzq < 4) return null;

    // Sanidad: dimensiones del rectángulo detectado vs calibrado
    const altoPx = (yBot - yTop + 1) / escala;
    const anchoPx = (xDer - xIzq + 1) / escala;
    const altoCal = box[3] * bmp.height;
    const anchoCal = box[2] * bmp.width;
    if (altoPx < altoCal * 0.45 || altoPx > altoCal * 2.4) return null;
    if (anchoPx < anchoCal * 0.5 || anchoPx > anchoCal * 2.2) return null;

    // ÚNICA caja plausible: recorte centrado en ella (padding leve)
    const fx = wx + xIzq / g.w * ww;
    const fy = wy + yTop / g.h * wh;
    const fw = (xDer - xIzq + 1) / g.w * ww;
    const fh = (yBot - yTop + 1) / g.h * wh;
    return [
      Math.max(0, Math.min(1 - fw, fx)),
      Math.max(0, Math.min(1 - fh, fy)),
      Math.min(1, fw),
      Math.min(1, fh),
    ];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// [T4/F1.5] Banner: banda oscura en el tercio superior central
// ------------------------------------------------------------

/** Detecta la banda oscura del banner (blanco-sobre-negro) y devuelve
 *  su box [x,y,w,h] en fracciones, o null si no hay banda clara. */
function buscarBandaBanner(
  bmp: ImageBitmap
): [number, number, number, number] | null {
  try {
    const yDesde = 0.04;
    const yHasta = 0.35;
    const sy = Math.round(yDesde * bmp.height);
    const sh = Math.max(8, Math.round((yHasta - yDesde) * bmp.height));
    const sx = Math.round(0.15 * bmp.width);
    const sw = Math.max(8, Math.round(0.7 * bmp.width));
    const W = 200;
    const escala = W / sw;
    const H = Math.max(8, Math.round(sh * escala));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      liberarCanvas(canvas);
      return null;
    }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, W, H);
    const g = grisDe(canvas);
    liberarCanvas(canvas);
    if (!g) return null;

    // Densidad de píxeles MUY oscuros por fila (el banner es negro sólido)
    const dens = new Float32Array(g.h);
    for (let y = 0; y < g.h; y++) {
      let n = 0;
      for (let x = 0; x < g.w; x++) {
        if (g.gris[y * g.w + x] < 80) n++;
      }
      dens[y] = n / g.w;
    }
    // Runs de filas densas (banner) — altura plausible de banner
    const filasPorActa = g.h / (yHasta - yDesde);
    let mejor: { a: number; b: number; dens: number } | null = null;
    let a = -1;
    let acum = 0;
    for (let y = 0; y <= g.h; y++) {
      const denso = y < g.h && dens[y] > 0.55;
      if (denso) {
        if (a < 0) {
          a = y;
          acum = 0;
        }
        acum += dens[y];
      }
      if ((!denso || y === g.h) && a >= 0) {
        const altoFr = (y - a) / filasPorActa;
        if (altoFr >= 0.008 && altoFr <= 0.06) {
          const dMedia = acum / (y - a);
          if (dMedia > 0.62 && (!mejor || dMedia > mejor.dens)) {
            mejor = { a, b: y - 1, dens: dMedia };
          }
        }
        a = -1;
        acum = 0;
      }
    }
    if (!mejor) return null;
    const yTopFr = yDesde + mejor.a / filasPorActa;
    const yBotFr = yDesde + (mejor.b + 1) / filasPorActa;
    const hFr = Math.max(0.006, yBotFr - yTopFr);
    return [0.2, Math.max(0, yTopFr - 0.002), 0.6, hFr + 0.004];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Reconocimiento por zona (con ensemble T3)
// ------------------------------------------------------------

export interface CampoOcrConNotas extends CampoOcr {
  /** Trazabilidad del ensemble (ej. "multivariante-discrepan"). */
  notas?: string[];
  /** true → el recorte se centró en la caja impresa detectada (T6). */
  cajaAdaptada?: boolean;
}

async function reconocerConVariante(
  worker: TesseractWorkerLike,
  canvas: HTMLCanvasElement,
  whitelist: string,
  psm: string
): Promise<LecturaVariante | null> {
  try {
    await worker.setParameters({
      tessedit_char_whitelist: whitelist,
      tessedit_pageseg_mode: psm,
      user_defined_dpi: "300",
    });
    const { data } = await worker.recognize(canvas);
    const valor = (data.text ?? "").replace(/\s+/g, "");
    const confianza = Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(1, data.confidence / 100))
      : 0;
    if (!valor) return null;
    return { valor, confianza, variante: "A" };
  } catch {
    return null;
  }
}

/**
 * [T3] Reconoce UNA zona con ensemble early-exit:
 *  A (siempre) → estructural OK? fin · B → C · votación por dígito.
 */
async function reconocerZona(
  worker: TesseractWorkerLike,
  bmp: ImageBitmap,
  box: [number, number, number, number],
  zona: Pick<ZonaOcr, "whitelist" | "digitos">,
  presupuesto: { restante: number }
): Promise<CampoOcrConNotas | null> {
  const t0 = performance.now();
  if (presupuesto.restante <= 0) return null;

  // [T6] caja adaptativa (si la hay) o fija calibrada
  const cajaDetectada = localizarCajaImpresa(bmp, box);
  const boxEfectiva = cajaDetectada ?? box;

  const base = recorteDesdeBitmap(bmp, boxEfectiva, LADO_MAX_RECORTE);
  if (!base) return null;

  const notas: string[] = [];
  try {
    // ── Variante A (siempre): tal cual, PSM 7
    const a = await reconocerConVariante(worker, base, zona.whitelist, "7");
    let lecturas: LecturaVariante[] = [];
    if (a && pasaEstructural(a.valor, zona.digitos)) {
      lecturas = [a];
    } else if (performance.now() - t0 < TOPE_VARIANTES_MS && presupuesto.restante > 0) {
      // ── Variante B: contraste p85 + PSM 7 (early-exit: solo si A falló)
      estirarContraste(base);
      const b = await reconocerConVariante(worker, base, zona.whitelist, "7");
      if (b && pasaEstructural(b.valor, zona.digitos)) {
        lecturas = [b];
      } else if (performance.now() - t0 < TOPE_VARIANTES_MS && presupuesto.restante > 0) {
        // ── Variante C: b/n Bradley ×2.5 + PSM 8
        const cCanvas = recorteDesdeBitmap(bmp, boxEfectiva, LADO_MAX_RECORTE, ESCALA_VARIANTE_C);
        if (cCanvas) {
          try {
            bradleyBinarizar(cCanvas);
            const c = await reconocerConVariante(worker, cCanvas, zona.whitelist, "8");
            if (c) c.variante = "C";
            const candidatas = [b, c].filter(
              (l): l is LecturaVariante => l !== null && pasaEstructural(l.valor, zona.digitos)
            );
            if (candidatas.length > 0) lecturas = candidatas;
          } finally {
            liberarCanvas(cCanvas);
          }
        }
      }
    }

    presupuesto.restante -= performance.now() - t0;
    if (lecturas.length === 0) {
      // Nada estructural: devolver la mejor lectura cruda como pista
      // (confianza baja) — el ruteo la rechaza por validez (fail-safe).
      const cruda = [a].filter((l): l is LecturaVariante => l !== null);
      if (cruda.length === 0) return null;
      return { valor: cruda[0].valor, confianza: cruda[0].confianza };
    }

    const voto = votarPorDigito(lecturas);
    if (!voto) return null;
    const ganadora =
      lecturas.find((l) => l.valor === voto.valor) ?? lecturas[0];
    if (voto.discrepancia) notas.push("multivariante-discrepan");
    return {
      valor: voto.valor,
      confianza: ganadora.confianza,
      notas: notas.length ? notas : undefined,
      cajaAdaptada: cajaDetectada != null ? true : undefined,
    };
  } catch {
    return null;
  } finally {
    liberarCanvas(base);
  }
}

/**
 * Reconoce TODAS las zonas de ruteo sobre el acta rectificada
 * (dataURL). [T1] el bitmap se decodifica UNA vez y todas las
 * zonas se recortan desde él. [T2] el orden de PROCESAMIENTO sigue
 * ORDEN_LECTURA_RUTEO (mesa primero — prioridad de feedback).
 * Reconocimiento en serie con presupuesto global de 5 s (+1.5 s de
 * margen máximo para el ensemble). Fallo suave: zonas fallidas null.
 */
export async function reconocerZonasRuteo(
  imagenProcesadaUrl: string,
  zonas: ZonaOcr[],
  opts?: { orden?: Array<ZonaOcr["id"]> }
): Promise<Record<string, CampoOcrConNotas | null>> {
  const out: Record<string, CampoOcrConNotas | null> = {};
  const worker = await workerOcrRuteo();
  if (!worker) {
    for (const z of zonas) out[z.id] = null;
    return out;
  }

  // [T2] orden de procesamiento (por defecto mesa→puesto→zona→país→depto)
  const orden = opts?.orden ?? ORDEN_LECTURA_RUTEO;
  const porId = new Map(zonas.map((z) => [z.id, z]));
  const ordenadas: ZonaOcr[] = [];
  for (const id of orden) {
    const z = porId.get(id);
    if (z) ordenadas.push(z);
  }
  for (const z of zonas) {
    if (!orden.includes(z.id)) ordenadas.push(z);
  }

  const t0 = performance.now();
  let bmp: ImageBitmap | null = null;
  try {
    const res = await fetch(imagenProcesadaUrl);
    const blob = await res.blob();
    bmp = await createImageBitmap(blob);
  } catch {
    for (const z of zonas) out[z.id] = null;
    return out;
  }

  try {
    const presupuesto = { restante: PRESUPUESTO_MS - 1_500 }; // margen de arranque
    for (const zona of ordenadas) {
      // reconocerZona corta por presupuesto (early-exit en la entrada)
      out[zona.id] = await reconocerZona(worker, bmp, zona.box, zona, presupuesto);
    }
    return out;
  } finally {
    bmp.close();
    // Medición T1 (worklog): tiempo total del reconocimiento de zonas
    try {
      const dt = performance.now() - t0;
      (window as unknown as { __digielectOcrUltimaDuracionMs?: number }).__digielectOcrUltimaDuracionMs = dt;
    } catch {
      /* sin window (tests) */
    }
  }
}

// ------------------------------------------------------------
// [T4/F1.5] Pistas impresas: barcode15, Ver/Pag, footer, banner
// ------------------------------------------------------------

export interface TextosPistas {
  /** Línea impresa bajo el código de barras ("710003993010102 Ver: 01 Pag: 1 de 2") */
  barcodeImpreso: string | null;
  /** Pie del formulario ("No. Form: 399 · KIT 399 · Civ 797/798") */
  footer: string | null;
  /** Banner del ejemplar con pasada INVERTIDA ("TRANSMISION" / "CONSUL/EMBAJADOR") */
  banner: string | null;
}

/**
 * [F1.5] Lee las pistas impresas del acta rectificada (3 pasadas OCR
 * cortas sobre el MISMO bitmap decodificado 1× — T1). El banner se
 * busca dinámicamente (banda oscura por densidad de píxeles en el
 * tercio superior central) y se reconoce con INVERSIÓN. Fallo suave:
 * pista no leída → null; el flujo continúa con las demás señales.
 */
export async function reconocerPistas(
  imagenProcesadaUrl: string
): Promise<TextosPistas | null> {
  const worker = await workerOcrRuteo();
  if (!worker) return null;
  let bmp: ImageBitmap | null = null;
  try {
    const res = await fetch(imagenProcesadaUrl);
    const blob = await res.blob();
    bmp = await createImageBitmap(blob);
  } catch {
    return null;
  }

  const leer = async (
    box: [number, number, number, number],
    whitelist: string,
    psm: string,
    invertir = false,
    ladoMax = 1200
  ): Promise<string | null> => {
    const canvas = recorteDesdeBitmap(bmp, box, ladoMax);
    if (!canvas) return null;
    try {
      if (invertir) invertirCanvas(canvas);
      await worker.setParameters({
        tessedit_char_whitelist: whitelist,
        tessedit_pageseg_mode: psm,
        user_defined_dpi: "300",
      });
      const { data } = await worker.recognize(canvas);
      const texto = (data.text ?? "").trim();
      return texto || null;
    } catch {
      return null;
    } finally {
      liberarCanvas(canvas);
    }
  };

  try {
    const bannerBox = buscarBandaBanner(bmp);
    // En serie (el worker de tesseract NO es reentrante)
    const barcodeImpreso = await leer(
      [0.2, 0.04, 0.8, 0.018],
      "0123456789VEDPAGvedpag.:· ",
      "7"
    );
    const footer = await leer(
      [0.0, 0.93, 1.0, 0.07],
      "0123456789KITCIVONoFormkitcivon.:/· ",
      "6",
      false,
      1600
    );
    const banner = bannerBox
      ? await leer(bannerBox, "ABCDEFGHIJKLMNOPQRSTUVWXYZ/ ", "7", true, 1400)
      : null;
    return { barcodeImpreso, footer, banner };
  } finally {
    bmp.close();
  }
}
