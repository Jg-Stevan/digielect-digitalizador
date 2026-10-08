/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Exportación PDF adaptativa (§8 del usuario) — lib compartida.
 *
 * Consumidores:
 *  · EditorView           → PDF de UN documento (presupuesto §8).
 *  · LibraryView          → PDF de TODA la biblioteca (multi-documento con
 *                           outline/marcadores por documento y presupuesto
 *                           global escalado).
 *
 * Reglas §8 intactas:
 *  · PNG (filtros sin pérdida raw|text|bw) se embebe SIN re-encode.
 *  · JPEG se re-encodea por intentos {0,q0.90}→{2600,q0.82}→{2200,q0.78}.
 *  · Tamaño de página adaptativo: aspecto de cada página, largo 297 mm.
 *  · Presupuesto de bytes con piso y techo.
 */

import { jsPDF } from "jspdf";
import { loadImage } from "@/lib/scanner-core/image-processor";
import { PNG_FILTERS, type ScanDocument } from "@/lib/scanner-core/types";

const MB = 1024 * 1024;

export type ExportQuality = "standard" | "alta" | "máxima";

/** Paso de re-encode JPEG por intento (constantes exactas del §8). */
export interface ExportAttempt {
  longSide: number;
  quality: number;
}

const ATTEMPTS_MAX: readonly ExportAttempt[] = [
  { longSide: 0, quality: 0.95 },
  { longSide: 0, quality: 0.9 },
  { longSide: 2600, quality: 0.82 },
  { longSide: 2200, quality: 0.78 },
];
const ATTEMPTS_ALTA: readonly ExportAttempt[] = [
  { longSide: 0, quality: 0.9 },
  { longSide: 2600, quality: 0.82 },
  { longSide: 2200, quality: 0.78 },
];
const ATTEMPTS_STANDARD: readonly ExportAttempt[] = [
  { longSide: 2600, quality: 0.82 },
  { longSide: 2200, quality: 0.78 },
];

export function attemptsFor(quality: ExportQuality): readonly ExportAttempt[] {
  if (quality === "standard") return ATTEMPTS_STANDARD;
  if (quality === "máxima") return ATTEMPTS_MAX;
  return ATTEMPTS_ALTA;
}

/** Lado mayor (mm) de la página PDF — tamaño adaptativo por página (§8). */
export const PDF_LONG_SIDE_MM = 297;

/** C8: canvas → data URL JPEG vía toBlob (ASÍNCRONO, no bloquea el hilo —
 *  regla propia “error #22”) con toDataURL de respaldo si toBlob falla. */
async function canvasToJpegDataUrl(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<string> {
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
    );
    if (blob && blob.size > 0) {
      return await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("FileReader falló"));
        fr.readAsDataURL(blob);
      });
    }
  } catch {
    /* respaldo abajo */
  }
  return canvas.toDataURL("image/jpeg", quality);
}

/** Re-encode JPEG de una página a los parámetros del intento (lado 0 = tamaño
 *  original). Devuelve el data URL y las dimensiones reales. */
export async function toJpegAt(
  src: string,
  longSide: number,
  quality: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src);
  const scale = longSide > 0 ? Math.min(1, longSide / Math.max(img.width, img.height)) : 1;
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Sin contexto 2D");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  // C8: encode asíncrono (toBlob) — antes toDataURL síncrono sobre canvas
  // grandes (riesgo de memoria/jank en Safari).
  return { dataUrl: await canvasToJpegDataUrl(canvas, quality), width, height };
}

/**
 * Convierte cualquier data URL (svg/jpeg/png…) en JPEG sobre canvas,
 * aplanando transparencias. Sirve para el OCR (payload normalizado)
 * y para el PDF (jsPDF solo acepta raster).
 *
 * maxSide 2400 (subido desde 1400 — F-OCR): el modelo de visión necesita
 * píxeles reales para el texto pequeño; a 1400 px las líneas finas se
 * derretían y el OCR salía borroso. 2400 px ≈ 300 DPI en carta y sigue
 * muy por debajo del límite de payload (10 MB).
 */
export async function toJpeg(
  src: string,
  maxSide = 2400
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(src);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Sin contexto 2D");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  // C8: encode asíncrono (toBlob) — ver toJpegAt.
  return { dataUrl: await canvasToJpegDataUrl(canvas, 0.92), width, height };
}

export function sanitizeFileName(title: string): string {
  const clean = title.replace(/[\\/:*?"<>|]/g, "").trim();
  return clean.length > 0 ? clean : "documento";
}

/** Datos crudos (PNG tal cual o JPEG re-encodeado) + tamaño de página mm. */
async function pageForAttempt(
  src: string,
  filter: ScanDocument["pages"][number]["filter"],
  attempt: ExportAttempt
): Promise<{ dataUrl: string; w: number; h: number; isPng: boolean }> {
  const isPng = PNG_FILTERS.has(filter) && src.startsWith("data:image/png");
  if (isPng) {
    const img = await loadImage(src);
    return { dataUrl: src, w: img.naturalWidth, h: img.naturalHeight, isPng: true };
  }
  const r = await toJpegAt(src, attempt.longSide, attempt.quality);
  return { dataUrl: r.dataUrl, w: r.width, h: r.height, isPng: false };
}

/** Dimensiones de página adaptativas: aspecto de la página, largo 297 mm. */
function adaptivePageSize(w: number, h: number): { pageW: number; pageH: number; orientation: "portrait" | "landscape" } {
  const pageW = w >= h ? PDF_LONG_SIDE_MM : (PDF_LONG_SIDE_MM * w) / h;
  const pageH = w >= h ? (PDF_LONG_SIDE_MM * h) / w : PDF_LONG_SIDE_MM;
  return { pageW, pageH, orientation: pageW > pageH ? "landscape" : "portrait" };
}

/* ------------------------------------------------------------------ */
/* Portada con índice (PDF de biblioteca)                             */
/* ------------------------------------------------------------------ */

const COVER = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 20,
  blue: [0, 122, 255] as const,
  black: [28, 28, 30] as const,
  gray: [142, 142, 147] as const,
  hair: [229, 229, 234] as const,
  thumbW: 15,
  thumbH: 19,
  rowH: 24,
};

/** Alto ocupado por la cabecera de la portada antes de la primera fila
 *  (título + regla azul + meta + fecha + etiqueta ÍNDICE + regla). */
const COVER_HEADER_MM = 67 - COVER.marginMm;

/** Nº de páginas A4 que ocupa el índice: 8 filas en la primera (cabecera)
 *  y 10 en cada continuación. Debe coincidir con addCoverPages. */
function coverPageCount(entryCount: number): number {
  const firstPageRows = Math.floor(
    (COVER.heightMm - COVER.marginMm - COVER.marginMm - COVER_HEADER_MM - 6) / COVER.rowH
  );
  if (entryCount <= firstPageRows) return 1;
  const restRows = Math.floor(
    (COVER.heightMm - COVER.marginMm - COVER.marginMm - 6) / COVER.rowH
  );
  return 1 + Math.ceil((entryCount - firstPageRows) / restRows);
}

/** Trunca un título con elipsis para que quepa en el ancho disponible. */
function truncateToWidth(pdf: jsPDF, text: string, maxWidthMm: number): string {
  if (pdf.getTextWidth(text) <= maxWidthMm) return text;
  let t = text;
  while (t.length > 1 && pdf.getTextWidth(`${t}…`) > maxWidthMm) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

export interface CoverEntry {
  title: string;
  pageCount: number;
  /** Página del PDF donde empieza el documento (1-indexada). */
  startPage: number;
  /** Miniatura de la primera página (data URL jpeg/png) — opcional. */
  thumbnail?: string;
}

export interface CoverMeta {
  docCount: number;
  pageCount: number;
  /** Título de la portada. Por defecto «Biblioteca de documentos». */
  title?: string;
}

/** Dibuja la(s) página(s) de portada con índice. El jsPDF debe estar RECIÉN
 *  creado (vacío, A4, página actual 1): las páginas de portada van primero
 *  y las de documentos se añaden después con addPage. */
function addCoverPages(pdf: jsPDF, entries: CoverEntry[], meta: CoverMeta): void {
  const m = COVER.marginMm;
  const date = new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());

  // — Cabecera (página 1) —
  let y = m + 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(24);
  pdf.setTextColor(...COVER.black);
  pdf.text(meta.title ?? "Biblioteca de documentos", m, y);

  y += 5;
  pdf.setDrawColor(...COVER.blue);
  pdf.setLineWidth(1);
  pdf.line(m, y, m + 42, y);

  y += 9;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.setTextColor(...COVER.gray);
  pdf.text(
    `${meta.docCount} ${meta.docCount === 1 ? "documento" : "documentos"} · ${meta.pageCount} ${
      meta.pageCount === 1 ? "página" : "páginas"
    }`,
    m,
    y
  );
  y += 5.5;
  pdf.setFontSize(9);
  pdf.text(date, m, y);

  // — Índice —
  y += 12;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(...COVER.gray);
  pdf.text("ÍNDICE", m, y);
  y += 3.5;
  pdf.setDrawColor(...COVER.hair);
  pdf.setLineWidth(0.4);
  pdf.line(m, y, COVER.widthMm - m, y);
  y += 6;

  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i]!;
    // Nueva página de índice si la fila no cabe.
    if (y + COVER.rowH > COVER.heightMm - m) {
      pdf.addPage([COVER.widthMm, COVER.heightMm], "portrait");
      y = m;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.setTextColor(...COVER.gray);
      pdf.text("ÍNDICE (CONTINUACIÓN)", m, y);
      y += 8;
    }

    // Miniatura de la primera página (best-effort).
    if (e.thumbnail) {
      try {
        const fmt = e.thumbnail.startsWith("data:image/png") ? "PNG" : "JPEG";
        pdf.addImage(e.thumbnail, fmt, m, y, COVER.thumbW, COVER.thumbH);
      } catch {
        /* sin miniatura: la fila sigue siendo válida */
      }
    }

    const textX = m + COVER.thumbW + 6;
    const textW = COVER.widthMm - m - textX - 22;

    // Nº de orden en azul + título truncado.
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10.5);
    pdf.setTextColor(...COVER.blue);
    pdf.text(String(i + 1).padStart(2, "0"), textX, y + 6.5);
    pdf.setTextColor(...COVER.black);
    pdf.text(truncateToWidth(pdf, e.title, textW - 10), textX + 9, y + 6.5);

    // Subtítulo: nº de páginas.
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...COVER.gray);
    pdf.text(`${e.pageCount} ${e.pageCount === 1 ? "página" : "páginas"}`, textX + 9, y + 12);

    // Página de inicio alineada a la derecha.
    pdf.setFontSize(9);
    const startLabel = `pág. ${e.startPage}`;
    pdf.text(startLabel, COVER.widthMm - m - pdf.getTextWidth(startLabel), y + 6.5);

    // Separador fino entre filas (excepto tras la última).
    if (i < entries.length - 1) {
      pdf.setDrawColor(...COVER.hair);
      pdf.setLineWidth(0.2);
      pdf.line(m, y + COVER.rowH - 3.5, COVER.widthMm - m, y + COVER.rowH - 3.5);
    }
    y += COVER.rowH;
  }

  // — Pie (en la última página de portada) —
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(...COVER.gray);
  pdf.text("Generado con Escáner", m, COVER.heightMm - m / 2);
  const pagesLabel = `Portada con índice · ${date}`;
  pdf.text(
    pagesLabel,
    COVER.widthMm - m - pdf.getTextWidth(pagesLabel),
    COVER.heightMm - m / 2
  );
}

export interface BuiltPdf {
  pdf: jsPDF;
  bytes: number;
  adjusted: boolean;
  budgetBytes: number;
}

/**
 * Construye el PDF adaptativo (§8) de UN documento SIN descargarlo.
 * Presupuesto min(max(n,3),8) MB — ~1MB/página con piso de 3 MB y techo
 * de 8 MB. PNG (raw|text|bw) se embebe SIN re-encode; JPEG se re-encodea
 * por intento hasta caber en el presupuesto.
 */
export async function buildDocPdf(
  doc: ScanDocument,
  quality: ExportQuality
): Promise<BuiltPdf> {
  const totalPages = doc.pages.length;
  const budgetBytes = Math.min(Math.max(totalPages, 3), 8) * MB;
  const attempts = attemptsFor(quality);
  let attemptIdx = 0;
  let bytes = 0;
  let pdf: jsPDF | null = null;

  for (; attemptIdx < attempts.length; attemptIdx += 1) {
    const attempt = attempts[attemptIdx]!;
    let first = true;
    pdf = null;
    for (let i = 0; i < totalPages; i += 1) {
      const p = doc.pages[i]!;
      const { dataUrl, w, h, isPng } = await pageForAttempt(p.processed, p.filter, attempt);
      const { pageW, pageH, orientation } = adaptivePageSize(w, h);
      if (first) {
        pdf = new jsPDF({ orientation, unit: "mm", format: [pageW, pageH], compress: true });
        first = false;
      } else {
        pdf!.addPage([pageW, pageH], orientation);
      }
      pdf!.addImage(dataUrl, isPng ? "PNG" : "JPEG", 0, 0, pageW, pageH);
    }
    if (!pdf) throw new Error("PDF vacío");
    bytes = pdf.output("blob").size;
    if (bytes <= budgetBytes) break;
  }

  if (!pdf) throw new Error("PDF vacío");
  const adjusted = bytes > budgetBytes && attemptIdx >= attempts.length;
  // Metadatos XMP: título + etiquetas del documento como keywords.
  setPdfMetadata(pdf, {
    title: doc.title || "Documento",
    subject: `Documento digitalizado · ${doc.pages.length} ${
      doc.pages.length === 1 ? "página" : "páginas"
    }`,
    tags: doc.tags ?? [],
  });
  return { pdf, bytes, adjusted, budgetBytes };
}

export interface LibraryPdfOptions {
  /** Añade una portada A4 con índice (título, miniaturas, nº de página de
   *  cada documento). Por defecto true. */
  cover?: boolean;
  /** Título de la portada (si cover=true). */
  coverTitle?: string;
}

/* ------------------------------------------------------------------ */
/* Metadatos XMP del PDF (título, etiquetas como keywords)             */
/* ------------------------------------------------------------------ */

/** Escribe los metadatos del documento (XMP/Info del PDF): título,
 *  asunto, autor y las ETIQUETAS como keywords — así los buscadores de
 *  escritorio (Spotlight, Explorer) indexan el contenido y las etiquetas
 *  viajan con el archivo. Best-effort: nunca rompe la exportación. */
function setPdfMetadata(
  pdf: jsPDF,
  meta: { title: string; subject: string; tags?: string[] }
): void {
  try {
    const unique = [...new Set((meta.tags ?? []).map((t) => t.trim()).filter(Boolean))];
    (pdf as unknown as {
      setProperties: (p: Record<string, string>) => void;
    }).setProperties({
      title: meta.title,
      subject: meta.subject,
      author: "Escáner",
      keywords: unique.join(", "),
      creator: "Escáner — digitalizador de documentos",
    });
  } catch {
    /* metadatos best-effort */
  }
}

/**
 * Construye UN PDF con TODOS los documentos indicados:
 *  · Portada A4 con índice: título, fecha, miniatura y página de inicio de
 *    cada documento (opcional vía options.cover, por defecto sí).
 *  · Cada documento conserva sus páginas con tamaño adaptativo §8.
 *  · Outline (marcadores) con el título de cada documento → navegación
 *    directa en cualquier lector de PDF.
 *  · Presupuesto global escalado: min(max(páginas, 3), 30) MB (~1 MB/página
 *    con techo ampliado para bibliotecas grandes). Misma escalera de
 *    intentos §8, aplicada a la vez a TODAS las páginas.
 *  · onProgress(docIdx, docCount, title) permite toasts de progreso.
 */
export async function buildLibraryPdf(
  docs: ScanDocument[],
  quality: ExportQuality,
  onProgress?: (info: { docIndex: number; docCount: number; title: string }) => void,
  options?: LibraryPdfOptions
): Promise<BuiltPdf & { docCount: number; pageCount: number; coverPages: number }> {
  if (docs.length === 0) throw new Error("No hay documentos");
  const pageCount = docs.reduce((acc, d) => acc + d.pages.length, 0);
  if (pageCount === 0) throw new Error("No hay páginas");

  const withCover = options?.cover !== false;
  // Nº de páginas de portada (matemática pura: necesaria ANTES de dibujar
  // para conocer las páginas de inicio del índice y del outline).
  const coverPages = withCover ? coverPageCount(docs.length) : 0;

  // Página de inicio de cada documento (1-indexada, tras la portada).
  let startPage = coverPages + 1;
  const docStartPages: number[] = docs.map((d) => {
    const s = startPage;
    startPage += d.pages.length;
    return s;
  });

  // Entradas del índice (compartidas entre intentos: se re-dibujan cada vez
  // porque cada intento crea un jsPDF nuevo).
  const entries: CoverEntry[] = docs.map((d, i) => ({
    title: d.title || "Documento",
    pageCount: d.pages.length,
    startPage: docStartPages[i]!,
    thumbnail: d.pages[0]?.thumbnail,
  }));
  const coverMeta: CoverMeta = {
    docCount: docs.length,
    pageCount,
    title: options?.coverTitle,
  };

  // Presupuesto global: escalado por nº de páginas con techo de 30 MB.
  const budgetBytes = Math.min(Math.max(pageCount, 3), 30) * MB;
  const attempts = attemptsFor(quality);
  let attemptIdx = 0;
  let bytes = 0;
  let pdf: jsPDF | null = null;

  for (; attemptIdx < attempts.length; attemptIdx += 1) {
    const attempt = attempts[attemptIdx]!;
    let first = true;
    pdf = null;

    // Portada con índice al PRINCIPIO (A4). Las páginas de documentos se
    // añaden detrás con addPage: jsPDF no reordena contenido ya embebido.
    if (withCover) {
      pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: [COVER.widthMm, COVER.heightMm],
        compress: true,
      });
      first = false;
      addCoverPages(pdf, entries, coverMeta);
    }

    for (let d = 0; d < docs.length; d += 1) {
      const doc = docs[d]!;
      onProgress?.({ docIndex: d + 1, docCount: docs.length, title: doc.title });
      for (let i = 0; i < doc.pages.length; i += 1) {
        const p = doc.pages[i]!;
        const { dataUrl, w, h, isPng } = await pageForAttempt(p.processed, p.filter, attempt);
        const { pageW, pageH, orientation } = adaptivePageSize(w, h);
        if (first) {
          pdf = new jsPDF({ orientation, unit: "mm", format: [pageW, pageH], compress: true });
          first = false;
        } else {
          pdf!.addPage([pageW, pageH], orientation);
        }
        pdf!.addImage(dataUrl, isPng ? "PNG" : "JPEG", 0, 0, pageW, pageH);
      }
    }
    if (!pdf) throw new Error("PDF vacío");
    bytes = pdf.output("blob").size;
    if (bytes <= budgetBytes) break;
  }

  if (!pdf) throw new Error("PDF vacío");

  // Outline: un marcador por documento apuntando a su primera página.
  try {
    let page = coverPages + 1;
    for (const doc of docs) {
      // jsPDF outline: (padre, título, opciones) — API del plugin outline.
      (pdf as unknown as {
        outline: { add: (parent: unknown, title: string, options: { pageNumber: number }) => void };
      }).outline.add(null, doc.title || "Documento", { pageNumber: page });
      page += doc.pages.length;
    }
  } catch {
    /* outline es best-effort: sin marcadores si el plugin no está */
  }

  // Metadatos XMP: título de la portada + unión de etiquetas como keywords.
  setPdfMetadata(pdf, {
    title: options?.coverTitle ?? "Biblioteca de documentos",
    subject: `${docs.length} ${docs.length === 1 ? "documento" : "documentos"} · ${pageCount} ${
      pageCount === 1 ? "página" : "páginas"
    }`,
    tags: docs.flatMap((d) => d.tags ?? []),
  });

  return { pdf, bytes, adjusted: bytes > budgetBytes && attemptIdx >= attempts.length, budgetBytes, docCount: docs.length, pageCount, coverPages };
}

/** Dispara la descarga de un blob con nombre limpio (patrón ancla). */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export { MB };
