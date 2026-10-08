/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * OCR compartido — motor local Tesseract.js (spa+eng) con salvavidas de
 * servidor: si existe /api/ocr (deploy con backend) se usa primero; en
 * despliegues estáticos (GitHub Pages) corre 100% en el dispositivo.
 *
 * Consumidores:
 *  · EditorView          → OCR de una página / de todo el documento.
 *  · LibraryView         → OCR por lotes sobre la selección múltiple.
 */

/** Respuesta del modelo cuando la imagen no contiene texto legible. */
export const OCR_NO_TEXT = "(sin texto legible)";

/** Payload máximo aceptado por el endpoint (~10 MB de data URL). */
const MAX_OCR_PAYLOAD = 10 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* F-OCR-LOCAL — motor Tesseract en el navegador (fallback)            */
/* ------------------------------------------------------------------ */
/* El despliegue del usuario es GitHub Pages (hosting ESTÁTICO): el
 * endpoint /api/ocr NO existe ahí y el OCR nunca pudo funcionar. Ahora:
 *  1) se intenta el servidor (vision-model, mejor calidad — dev/otros),
 *  2) si no hay servidor (404) o falla la red, corre Tesseract.js LOCAL
 *     (spa+eng) cargado desde CDN: funciona 100% en hosting estático. */

/** UMD de tesseract.js v5 (API estable createWorker/recognize/terminate). */
const TESSERACT_CDN =
  "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/** Lado máximo de la imagen que va al OCR local (rendimiento en móvil). */
const OCR_LOCAL_MAX_SIDE = 1600;

/** Tipos mínimos del global Tesseract (sin dependencia npm). */
interface TesseractWorkerResult {
  data: { text: string };
}
interface TesseractWorker {
  recognize(image: string): Promise<TesseractWorkerResult>;
  terminate(): Promise<unknown>;
}
interface TesseractLoggerArg {
  status?: string;
  progress?: number;
}
interface TesseractGlobal {
  createWorker(
    langs: string,
    oem?: number,
    options?: { logger?: (m: TesseractLoggerArg) => void }
  ): Promise<TesseractWorker>;
}

let tesseractPromise: Promise<TesseractGlobal> | null = null;

/** Inyecta el script del motor una sola vez y resuelve el global. */
function loadTesseract(): Promise<TesseractGlobal> {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise<TesseractGlobal>((resolve, reject) => {
    const w = window as unknown as { Tesseract?: TesseractGlobal };
    if (w.Tesseract) {
      resolve(w.Tesseract);
      return;
    }
    const el = document.createElement("script");
    el.src = TESSERACT_CDN;
    el.async = true;
    el.crossOrigin = "anonymous";
    el.onload = () => {
      if (w.Tesseract) resolve(w.Tesseract);
      else reject(new Error("El motor OCR no se pudo inicializar"));
    };
    el.onerror = () => {
      tesseractPromise = null; // permite reintentar con red restablecida
      reject(new Error("Sin conexión: no se pudo descargar el motor OCR"));
    };
    document.head.appendChild(el);
  });
  return tesseractPromise;
}

/** Reduce la imagen para el OCR local (más rápido y suficiente para texto). */
async function downscaleForOcr(dataUrl: string): Promise<string> {
  try {
    if (!dataUrl.startsWith("data:image")) return dataUrl;
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Imagen ilegible"));
      img.src = dataUrl;
    });
    const long = Math.max(img.naturalWidth, img.naturalHeight);
    if (long <= OCR_LOCAL_MAX_SIDE) return dataUrl;
    const scale = OCR_LOCAL_MAX_SIDE / long;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return dataUrl; // si el canvas falla, la original sirve igual
  }
}

/** OCR local con Tesseract (spa+eng). Descarga ~3 MB la PRIMERA vez. */
async function runOcrLocal(
  image: string,
  onProgress?: (p: number) => void
): Promise<string> {
  const Tesseract = await loadTesseract();
  const input = await downscaleForOcr(image);
  const worker = await Tesseract.createWorker("spa+eng", 1, {
    logger: (m) => {
      if (onProgress && m?.status === "recognizing text" && typeof m.progress === "number") {
        onProgress(m.progress);
      }
    },
  });
  try {
    const { data } = await worker.recognize(input);
    return (data?.text ?? "").trim();
  } finally {
    void worker.terminate();
  }
}

/** Intento por el endpoint del servidor (vision-model). Lanza si falla.
 *  A2: en build estático (Pages) ni se intenta — el fetch absoluto
 *  "/api/ocr" provocaba un round-trip 404 antes de CADA OCR. Y si hay
 *  servidor, se prefija el basePath (necesario bajo /web-scanner/). */
async function requestOcrServer(image: string): Promise<string> {
  if (process.env.NEXT_PUBLIC_STATIC === "1") {
    throw new Error("despliegue estático: OCR local");
  }
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const res = await fetch(`${base}/api/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? "Error de OCR");
  return (data.text ?? "").trim();
}

/**
 * OCR de una imagen: servidor si existe; LOCAL (Tesseract) si el despliegue
 * es estático (GitHub Pages) o el servidor falla — así el OCR funciona SIEMPRE.
 * `onProgress` (0-1) reporta el avance del reconocimiento local.
 */
export async function requestOcr(
  image: string,
  onProgress?: (p: number) => void
): Promise<string> {
  // Payload demasiado grande para el endpoint → directo al motor local.
  if (image.length > MAX_OCR_PAYLOAD) {
    return runOcrLocal(image, onProgress);
  }
  try {
    return await requestOcrServer(image);
  } catch (serverErr) {
    // 404 = hosting estático (GitHub Pages) → fallback esperado.
    // Otros fallos (red caída, 500) también caen al local: mejor un OCR
    // funcionando que un error seco.
    try {
      return await runOcrLocal(image, onProgress);
    } catch {
      throw serverErr instanceof Error ? serverErr : new Error("Error de OCR");
    }
  }
}

/**
 * Sentinela anti-rechazos: el vision-model a veces responde con disculpas
 * o meta-comentarios en lugar de admitir que no hay texto. Filtra esas
 * respuestas para no persistir basura en el documento.
 */
export function ocrTextIsValid(text: string): boolean {
  if (text === "" || text === OCR_NO_TEXT) return false;
  const t = text.toLowerCase();
  if (t.startsWith("lo siento") || t.startsWith("i'm sorry") || t.startsWith("i apologize")) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Búsqueda en el texto OCR (resaltado de coincidencias)               */
/* ------------------------------------------------------------------ */

/** Coincidencia de búsqueda: rango [start, end) sobre el texto ORIGINAL. */
export interface TextMatch {
  start: number;
  end: number;
}

/** Normaliza un carácter/texto para buscar (minúsculas, sin tildes). */
function foldText(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Busca TODAS las coincidencias (no solapadas) de `query` en `text`,
 * insensibles a mayúsculas y tildes, devolviendo rangos sobre el texto
 * original (no sobre el normalizado).
 */
export function findTextMatches(text: string, query: string): TextMatch[] {
  const q = foldText(query.trim());
  if (!q) return [];
  // Cadena plegada + mapa índice → posición en el original (la descomposición
  // NFD puede expandir un carácter base+diacrítico, el mapa lo resuelve).
  const folded: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    for (const ch of foldText(text[i]!)) {
      folded.push(ch);
      map.push(i);
    }
  }
  const hay = folded.join("");
  const out: TextMatch[] = [];
  let idx = hay.indexOf(q);
  while (idx >= 0) {
    const start = map[idx]!;
    const end = map[idx + q.length - 1]! + 1;
    out.push({ start, end });
    idx = hay.indexOf(q, idx + q.length);
  }
  return out;
}

/** Segmento del texto para renderizar con <mark>: hit = resaltar. */
export interface TextSegment {
  text: string;
  hit: boolean;
}

/** Trocea el texto en segmentos según las coincidencias (para <mark>). */
export function splitByMatches(text: string, matches: TextMatch[]): TextSegment[] {
  if (matches.length === 0) return [{ text, hit: false }];
  const out: TextSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) out.push({ text: text.slice(cursor, m.start), hit: false });
    out.push({ text: text.slice(m.start, m.end), hit: true });
    cursor = m.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

