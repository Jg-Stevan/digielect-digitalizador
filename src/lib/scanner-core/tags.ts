/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Etiquetas (tags) para organizar la biblioteca — patrón iOS (Notas/Archivos).
 *
 * Diseño:
 *  - Un documento puede llevar hasta MAX_TAGS etiquetas de MAX_TAG_LEN car.
 *  - Paleta determinista: el color nace de un hash del nombre → una misma
 *    etiqueta SIEMPRE tiene el mismo color en toda la app (chips de filtro,
 *    cards, hoja de info…), sin estado global.
 *  - Sin acentos ni caja: "Facturas" y "facturas" son la misma etiqueta
 *    (se guarda el primer término tal como lo escribió el usuario).
 */

import type { ScanDocument } from "./types";

export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

/** Paleta iOS (sin índigo/azul genérico de la marca para no confundir con
 *  acciones): tonos de sistema con variante suave para el fondo del chip. */
export const TAG_PALETTE: { dot: string; soft: string; softBorder: string; text: string }[] = [
  { dot: "#34c759", soft: "rgba(52,199,89,0.12)", softBorder: "rgba(52,199,89,0.32)", text: "#1f7a34" }, // verde
  { dot: "#ff9500", soft: "rgba(255,149,0,0.12)", softBorder: "rgba(255,149,0,0.32)", text: "#a35c00" }, // naranja
  { dot: "#af52de", soft: "rgba(175,82,222,0.12)", softBorder: "rgba(175,82,222,0.30)", text: "#7d2fb0" }, // morado
  { dot: "#ff2d55", soft: "rgba(255,45,85,0.10)", softBorder: "rgba(255,45,85,0.28)", text: "#c21b3e" }, // rosa
  { dot: "#5e5ce6", soft: "rgba(94,92,230,0.10)", softBorder: "rgba(94,92,230,0.28)", text: "#4543b8" }, // violeta
  { dot: "#30b0c7", soft: "rgba(48,176,199,0.12)", softBorder: "rgba(48,176,199,0.32)", text: "#1d7f92" }, // turquesa
  { dot: "#a2845e", soft: "rgba(162,132,94,0.12)", softBorder: "rgba(162,132,94,0.32)", text: "#7d6446" }, // marrón
];

/** Etiquetas de un documento (compat con registros viejos sin el campo). */
export function docTags(doc: Pick<ScanDocument, "tags">): string[] {
  return Array.isArray(doc.tags) ? doc.tags : [];
}

/** Hash simple de cadena (djb2) → índice de paleta estable. */
function hashIndex(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) & 0x7fffffff;
  }
  return h % TAG_PALETTE.length;
}

/** Color de una etiqueta (determinista por nombre). */
export function tagColor(tag: string) {
  return TAG_PALETTE[hashIndex(tag.toLowerCase())]!;
}

/** Normaliza una etiqueta para comparar (minúsculas, sin tildes, recortada). */
export function normalizeTag(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Valida/normaliza la entrada de una nueva etiqueta:
 *  recorta, colapsa espacios y limita la longitud. null = no válida. */
export function cleanTagInput(raw: string, existing: string[]): string | null {
  const t = raw.trim().replace(/\s+/g, " ").slice(0, MAX_TAG_LEN);
  if (!t) return null;
  if (existing.some((e) => normalizeTag(e) === normalizeTag(t))) return null; // ya existe
  return t;
}

/** Añade una etiqueta a una lista (si cabe y no existe). Devuelve la lista
 *  nueva o null si no cambió. */
export function addTag(tags: string[], tag: string): string[] | null {
  if (tags.length >= MAX_TAGS) return null;
  if (tags.some((t) => normalizeTag(t) === normalizeTag(tag))) return null;
  return [...tags, tag];
}

/** Quita una etiqueta por nombre. null si no estaba. */
export function removeTag(tags: string[], tag: string): string[] | null {
  if (!tags.some((t) => normalizeTag(t) === normalizeTag(tag))) return null;
  return tags.filter((t) => normalizeTag(t) !== normalizeTag(tag));
}

/** Conteo de uso por etiqueta en toda la biblioteca (para los chips de
 *  filtro y las sugerencias), ordenado por uso ↓ y luego alfabético. */
export function countTagUsage(documents: ScanDocument[]): { tag: string; count: number }[] {
  const map = new Map<string, { tag: string; count: number }>();
  for (const d of documents) {
    for (const t of docTags(d)) {
      const key = normalizeTag(t);
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { tag: t, count: 1 });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "es", { sensitivity: "base" })
  );
}
