/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Tipos del escáner de documentos.
 * 📍 PUNTO DE INTEGRACIÓN: cuando llegue la lógica real de precisión del usuario,
 * estas interfaces deben mantenerse estables.
 */

export type ScannerView = "library" | "camera" | "editor" | "settings";

/**
 * Filtros de página — EXACTAMENTE 3 (§8 del SPEC-MAESTRO, error #13):
 * los 3 modos reales del motor. Los 8 presets legacy (auto/color/grayscale/
 * blackwhite/whiteboard/document/natural) se migran vía normalizePageFilter.
 */
export type PageFilter = "original" | "text" | "bw";

export interface FilterPreset {
  id: PageFilter;
  label: string;
  description: string;
}

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "original", label: "Original", description: "Sin cambios" },
  { id: "text", label: "Texto claro", description: "Papel blanco, tinta marcada" },
  { id: "bw", label: "B/N adaptativo", description: "Blanco y negro puro, inmune a sombras" },
];

/**
 * Migración de datos legacy (§8.4 — obligatoria al hidratar IndexedDB):
 * los usuarios viejos tienen los 8 presets persistidos.
 */
export function normalizePageFilter(legacy: string): PageFilter {
  switch (legacy) {
    case "original":
      return "original";
    case "text":
    case "bw":
      return legacy;
    case "auto":
    case "document":
    case "whiteboard":
      return "text"; // mismo modo motor → look idéntico
    case "blackwhite":
      return "bw";
    case "natural":
    case "color":
    case "grayscale":
      return "original";
    default:
      return "bw"; // default del producto: B/N adaptativo
  }
}

/** Filtros cuyo modo de enhance se codifica como PNG sin pérdida
 *  (mime por modo §8 del usuario: raw|text|bw → PNG — R-10). */
export const PNG_FILTERS: ReadonlySet<PageFilter> = new Set<PageFilter>([
  "original", // raw
  "text", // text
  "bw", // bw
]);

/** Punto (normalizado 0-1) del marco de perspectiva. */
export interface Point {
  x: number;
  y: number;
}

/** Cuadrilátero de perspectiva: 0=top-left, 1=top-right, 2=bottom-right, 3=bottom-left */
export type Quad = [Point, Point, Point, Point];

export type QualityLevel = "excellent" | "good" | "fair" | "poor";

export interface PageQuality {
  level: QualityLevel;
  sharpness: number; // 0-100
  brightness: number; // 0-100
  contrast: number; // 0-100
  label: string;
}

/** Estadísticas del pipeline de precisión para una página procesada.
 *  Refleja el WarpOutcome REAL del worker (refined/fellBack del RANSAC)
 *  o el fallback canvas. Solo informativo — nunca altera el pipeline. */
export interface PagePrecision {
  /** "worker" = pipeline OpenCV real · "canvas" = fallback local. */
  engine: "worker" | "canvas";
  /** true = esquinas refinadas sub-píxel por líneas (RANSAC). */
  refined: boolean;
  /** Nº de esquinas firmes (0–4) del ajuste de líneas; null si no aplica. */
  cornersSolid: number | null;
  /** Dimensiones del resultado procesado. */
  width: number;
  height: number;
  /** Ms del enhance real (worker) o del canvas fallback. */
  elapsedMs?: number;
}

export interface ScanPage {
  id: string;
  /** data URL de la imagen cruda capturada */
  original: string;
  /** data URL procesada (recorte + filtro) */
  processed: string;
  /** data URL miniatura */
  thumbnail: string;
  filter: PageFilter;
  quad: Quad;
  /** true = quad ajustado por el humano (respetar al píxel en re-procesos) */
  quadManual?: boolean;
  rotation: number; // 0 | 90 | 180 | 270
  quality: PageQuality;
  /** Estadísticas del pipeline que produjo esta página (si es real). */
  precision?: PagePrecision;
  ocrText?: string;
  ocrDone: boolean;
  createdAt: number;
}

export interface ScanDocument {
  id: string;
  title: string;
  pages: ScanPage[];
  favorite: boolean;
  /** Etiquetas de organización (opcional para compat con registros viejos). */
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  /** ⭐ F-TRASH: fecha de borrado suave. Presente ⇒ el documento está en
   *  «Eliminados» (se purga definitivamente a los TRASH_RETENTION_DAYS).
   *  Ausente ⇒ documento vivo. Compat: registros viejos no lo traen. */
  deletedAt?: number;
}

/** Días que un documento permanece recuperable en «Eliminados» (iOS Files). */
export const TRASH_RETENTION_DAYS = 30;

/** ¿Está el documento en la papelera? */
export function isTrashed(doc: ScanDocument): boolean {
  return typeof doc.deletedAt === "number";
}

/** Días que le quedan al documento en la papelera (≥0, sin pasar de la retención). */
export function trashDaysLeft(doc: ScanDocument, now = Date.now()): number {
  const deletedAt = doc.deletedAt;
  if (deletedAt === undefined) return TRASH_RETENTION_DAYS;
  const elapsedDays = (now - deletedAt) / 86400000;
  return Math.max(0, Math.ceil(TRASH_RETENTION_DAYS - elapsedDays));
}

/** Página en sesión de captura (antes de guardar) */
export interface CapturePage {
  id: string;
  original: string;
  quad: Quad;
  /** true = el humano movió las esquinas → warp SIN refine y SIN shrink */
  quadManual?: boolean;
  filter: PageFilter;
  rotation: number;
  quality: PageQuality;
  /** Procesada persistida (solo modo revisión de documento: preview inmediato). */
  processed?: string;
  /** Clave de estado (id|quad|filtro|rotación) con la que se generó
   *  `processed` — el preview solo la usa si el estado NO ha cambiado
   *  (rotar/filtrar/recortar invalida la procesada guardada). */
  processedKey?: string;
  /** Miniatura coherente con `processed` (rotación rápida la actualiza). */
  thumbnail?: string;
  /** OCR (editor): texto reconocido en la página en edición. */
  ocrText?: string;
  ocrDone?: boolean;
  /** F-DEFER-CROP v6.2: la detección de bordes corre EN background DESPUÉS
   *  de abrir el editor (captura fluida — el usuario ya ve su página).
   *  true = detección aún en vuelo (pill «Ajustando recorte…»). Al resolver
   *  se aplica el quad SOLO si el usuario no recortó a mano (quadManual).
   *  Runtime-only: no se persiste ni viaja a ScanPage. */
  autoQuadPending?: boolean;
}

/** Clave de cache/estado de una página en sesión (id|quad|filtro|rotación).
 *  ÚNICA fuente del formato — la comparten EditorView (cache de previews) y
 *  beginReviewDocument (processedKey) para que nunca diverjan. */
export function capturePageKey(p: {
  id: string;
  quad: Quad;
  filter: PageFilter;
  rotation: number;
}): string {
  const quadKey = p.quad.map((q) => `${q.x.toFixed(4)},${q.y.toFixed(4)}`).join(";");
  return `${p.id}|${quadKey}|${p.filter}|${p.rotation}`;
}

export interface ScannerSettings {
  enhance: boolean;
  ocrEnabled: boolean;
  exportQuality: "standard" | "alta" | "máxima";
}

export const DEFAULT_SETTINGS: ScannerSettings = {
  enhance: true,
  // F-OCR-MANUAL v6.1: el reconocimiento pasa a BAJO DEMANDA (botón «Texto»
  // del editor) — el auto-OCR consumía memoria/CPU justo en los dispositivos
  // que menos tienen. La migración one-time en loadSettings fuerza el cambio
  // también en instalaciones previas.
  ocrEnabled: false,
  /** "máxima" por defecto (F-OCR): el usuario exige la mayor calidad de
   *  imagen posible para extraer bien el texto. */
  exportQuality: "máxima",
};

export function defaultQuad(): Quad {
  return [
    { x: 0.08, y: 0.1 },
    { x: 0.92, y: 0.06 },
    { x: 0.95, y: 0.92 },
    { x: 0.05, y: 0.95 },
  ];
}

export function excellentQuality(): PageQuality {
  return {
    level: "excellent",
    sharpness: 92,
    brightness: 88,
    contrast: 84,
    label: "Excelente",
  };
}

export function makeQuality(
  sharpness: number,
  brightness: number,
  contrast: number
): PageQuality {
  const score = (sharpness + brightness + contrast) / 3;
  const level: QualityLevel =
    score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "fair" : "poor";
  const label =
    level === "excellent"
      ? "Excelente"
      : level === "good"
        ? "Buena"
        : level === "fair"
          ? "Aceptable"
          : "Baja";
  return { level, sharpness, brightness, contrast, label };
}
