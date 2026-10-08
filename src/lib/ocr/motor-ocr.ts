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
// ============================================================

import { withBasePath } from "@/lib/env";
import type { CampoOcr } from "@/lib/contrato/types";
import type { ZonaOcr } from "./zonas-e14";

const TESS = "/ocr/tesseract";
const TESSDATA = "/ocr/tessdata";
/** Presupuesto total del OCR de ruteo (puerta Fase 5: ≤5 s gama media). */
const PRESUPUESTO_MS = 5_000;
/** Escala del recorte para el recognize (los dígitos impresos son pequeños). */
const ESCALA_RECORTE = 3;

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

/** Recorta una zona (fracciones) del dataUrl, escalada, a dataUrl. */
async function recortarZona(
  imagenUrl: string,
  box: [number, number, number, number],
  ladoMax: number
): Promise<HTMLCanvasElement | null> {
  try {
    const res = await fetch(imagenUrl);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const [x, y, w, h] = box;
    const sx = Math.max(0, Math.round(x * bmp.width));
    const sy = Math.max(0, Math.round(y * bmp.height));
    const sw = Math.max(8, Math.round(w * bmp.width));
    const sh = Math.max(8, Math.round(h * bmp.height));
    const canvas = document.createElement("canvas");
    const escala = Math.min(ESCALA_RECORTE, Math.max(1, ladoMax / Math.max(sw, sh)));
    canvas.width = Math.round(sw * escala);
    canvas.height = Math.round(sh * escala);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bmp.close();
      liberarCanvas(canvas);
      return null;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Reconoce UNA zona: recorte → recognize (whitelist + modo línea).
 * Devuelve valor crudo + confianza 0–1, o null si la zona falló.
 */
async function reconocerZona(
  worker: TesseractWorkerLike,
  imagenUrl: string,
  zona: ZonaOcr,
  presupuesto: { restante: number }
): Promise<CampoOcr | null> {
  const t0 = performance.now();
  if (presupuesto.restante <= 0) return null;
  const canvas = await recortarZona(imagenUrl, zona.box, 600);
  if (!canvas) return null;
  try {
    await worker.setParameters({
      tessedit_char_whitelist: zona.whitelist,
      // 7 = tratar el recorte como UNA línea de texto
      tessedit_pageseg_mode: "7",
      user_defined_dpi: "300",
    });
    const { data } = await worker.recognize(canvas);
    const valor = (data.text ?? "").replace(/\s+/g, "");
    const confianza = Number.isFinite(data.confidence)
      ? Math.max(0, Math.min(1, data.confidence / 100))
      : 0;
    presupuesto.restante -= performance.now() - t0;
    if (!valor) return { valor: "", confianza: 0 };
    return { valor, confianza };
  } catch {
    return null;
  } finally {
    liberarCanvas(canvas);
  }
}

/**
 * Reconoce TODAS las zonas de ruteo sobre el acta procesada
 * (dataURL). Reconocimiento en serie (el worker tesseract no
 * paraleliza) con presupuesto global de 5 s. Fallo suave: zonas
 * fallidas quedan en null.
 */
export async function reconocerZonasRuteo(
  imagenProcesadaUrl: string,
  zonas: ZonaOcr[]
): Promise<Record<string, CampoOcr | null>> {
  const out: Record<string, CampoOcr | null> = {};
  const worker = await workerOcrRuteo();
  if (!worker) {
    for (const z of zonas) out[z.id] = null;
    return out;
  }
  const presupuesto = { restante: PRESUPUESTO_MS - 1_500 }; // margen de arranque
  for (const zona of zonas) {
    out[zona.id] = await reconocerZona(worker, imagenProcesadaUrl, zona, presupuesto);
  }
  return out;
}
