/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Exportación de texto OCR — lib compartida.
 *
 * El texto reconocido de cada página viaja con el documento (IndexedDB);
 * aquí se consolida en un único texto con separadores de página para:
 *  · Exportar .txt desde el menú contextual de la biblioteca.
 *  · Copiar todo el documento desde el sheet «Texto» del editor.
 *  · Compartir como texto plano (Web Share API nivel 1).
 */

import type { ScanDocument } from "./types";
import { downloadBlob, sanitizeFileName } from "./pdf-export";

/** Página mínima con OCR (compatible con ScanPage y CapturePage). */
type OcrPageLike = { ocrText?: string };

/** Consolida el OCR de las páginas en UN texto (separadores «── Página N ──»
 *  solo cuando hay más de una página con texto). */
export function ocrTextOfPages(pages: readonly OcrPageLike[]): string {
  const withText = pages
    .map((p, i) => ({ index: i + 1, text: (p.ocrText ?? "").trim() }))
    .filter((p) => p.text.length > 0);
  if (withText.length === 0) return "";
  if (withText.length === 1) return withText[0]!.text;
  return withText.map((p) => `── Página ${p.index} ──\n${p.text}`).join("\n\n");
}

/** Texto OCR completo de un documento guardado. */
export function documentOcrText(doc: ScanDocument): string {
  return ocrTextOfPages(doc.pages);
}

/** ¿Tiene el documento al menos una página con texto OCR? */
export function docHasOcrText(doc: ScanDocument): boolean {
  return doc.pages.some((p) => (p.ocrText ?? "").trim().length > 0);
}

/** Palabras del texto (para toasts informativos). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Descarga el .txt del OCR del documento (UTF-8 con BOM para que Excel
 *  y Notepad de Windows respeten la codificación). */
export function downloadOcrTxt(doc: ScanDocument): { bytes: number; words: number } {
  const text = documentOcrText(doc);
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `${sanitizeFileName(doc.title)}.txt`);
  return { bytes: blob.size, words: countWords(text) };
}

/** Comparte el OCR como texto plano (Web Share API nivel 1); devuelve false
 *  si el entorno no soporta compartir (el llamador decide el fallback). */
export async function shareOcrText(doc: ScanDocument): Promise<boolean> {
  const text = documentOcrText(doc);
  if (!text || typeof navigator.share !== "function") return false;
  try {
    await navigator.share({ title: doc.title, text: text.slice(0, 4000) });
    return true;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return true; // cancelado ≠ error
    return false;
  }
}
