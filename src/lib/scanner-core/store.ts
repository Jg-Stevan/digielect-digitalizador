/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
"use client";

/**
 * Store global del escáner (Zustand).
 * Mantiene: vista activa, documentos guardados, sesión de captura y ajustes.
 */

import { create } from "zustand";
import type {
  CapturePage,
  PageFilter,
  Quad,
  ScanDocument,
  ScanPage,
  ScannerSettings,
  ScannerView,
} from "./types";
import { DEFAULT_SETTINGS, TRASH_RETENTION_DAYS, capturePageKey, isTrashed } from "./types";
import { initialDocuments } from "./mock-data";
import { processImage } from "./image-processor";
import {
  clearAllDocuments as idbClearAll,
  loadAllDocuments,
  loadSettings,
  persistDocument,
  removeDocument as idbRemove,
  saveManualOrder,
  saveSettings,
} from "./page-store";
import { addTag, removeTag } from "./tags";

let uid = 0;
export function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

/** localStorage: marca «onboarding completado» (primera ejecución). */
export const ONBOARDING_STORAGE_KEY = "escaner-onboarding-v1";

interface ScannerState {
  view: ScannerView;
  documents: ScanDocument[];
  activeDocumentId: string | null;

  /** Sesión de captura: páginas pendientes de guardar */
  capturePages: CapturePage[];
  /** Índice de página en edición dentro del editor */
  editingIndex: number;

  /** MODO REVISIÓN DE DOCUMENTO (F-NOVIEW): la 3ª interfaz (Digitalización)
   *  desaparece — la biblioteca abre el documento AQUÍ, en el Editor, igual
   *  que Adobe Scan. Mientras esté activo, la sesión de captura contiene las
   *  páginas del documento (con sus ids originales) y los cambios se
   *  fusionan de vuelta al salir (exitReviewToLibrary / X de la cámara). */
  reviewDocId: string | null;
  /** Abre un documento guardado en el editor (carga sus páginas como sesión). */
  beginReviewDocument: (docId: string) => void;
  /** Fusiona la sesión con su documento (por id: actualiza, añade, quita) y
   *  vuelve a la biblioteca. Solo reprocesa las páginas realmente cambiadas.
   *  Devuelve el docId o null. */
  saveSessionToDocument: () => Promise<string | null>;
  /** Sale del modo revisión fusionando cambios (auto-guardado, patrón Adobe). */
  exitReviewToLibrary: () => Promise<void>;

  /** Modo lote: nº de documentos guardados en cadena durante la sesión de
   *  cámara actual (sin volver a la biblioteca). 0 = lote inactivo. */
  batchSavedCount: number;

  settings: ScannerSettings;
  hydrated: boolean;

  /** Onboarding de 4 pasos (primera ejecución). Arranca SIEMPRE false
   *  (server + primer render del cliente — evita mismatch de hidratación);
   *  page.tsx lo activa tras montar leyendo ONBOARDING_STORAGE_KEY. */
  onboardingDone: boolean;
  /** Marca el onboarding como completado y persiste la marca. */
  completeOnboarding: () => void;

  setView: (view: ScannerView) => void;
  /** Abre un documento GUARDADO en el Editor (modo revisión, F-NOVIEW). */
  openDocument: (id: string) => void;

  /** Consulta que la biblioteca “presta” al detalle para abrir el buscador
   *  de texto OCR ya relleno y saltar a la primera coincidencia. */
  pendingFindQuery: string | null;
  setPendingFindQuery: (q: string | null) => void;

  /** Etiquetas: añade/quita a un documento (persiste). */
  addTagToDocument: (id: string, tag: string) => void;
  removeTagFromDocument: (id: string, tag: string) => void;
  setDocumentTags: (id: string, tags: string[]) => void;

  addCapturePage: (page: CapturePage) => void;
  removeCapturePage: (id: string) => void;
  updateCapturePage: (id: string, patch: Partial<CapturePage>) => void;
  setEditingIndex: (i: number) => void;
  clearCaptureSession: () => void;

  /** Lote: encadena un nuevo documento tras guardar (contador+1, sesión
   *  limpia, vuelve a la cámara). */
  startBatchDocument: () => void;
  /** Lote: termina la cadena (vuelve a biblioteca, contador a 0). */
  endBatch: () => void;

  saveSessionAsDocument: (title: string) => Promise<ScanDocument | null>;
  /** Borrado SUAVE: mueve el documento a «Eliminados» (deletedAt=ahora,
   *  recuperable TRASH_RETENTION_DAYS días). Sigue persistido. */
  deleteDocument: (id: string) => void;
  /** Saca el documento de «Eliminados» y lo devuelve a la biblioteca. */
  restoreDocument: (id: string) => void;
  /** Borrado DEFINITIVO de un documento ya en papelera (IndexedDB incluida). */
  purgeDocument: (id: string) => void;
  /** Vacía la papelera completa (borrado definitivo de todos los eliminados). */
  emptyTrash: () => void;
  renameDocument: (id: string, title: string) => void;
  toggleFavorite: (id: string) => void;
  addPageToDocument: (docId: string, page: CapturePage) => Promise<void>;
  deletePageFromDocument: (docId: string, pageId: string) => void;
  /** Reordena las páginas de un documento por lista completa de ids. */
  reorderPages: (docId: string, order: string[]) => void;
  /** Duplica un documento completo (copia profunda, «Título (copia)»). */
  duplicateDocument: (docId: string) => void;
  /** Aplica el orden MANUAL completo de la biblioteca (lista de ids del
   *  drag & drop) y lo persiste en el meta store. */
  setDocumentsOrder: (order: string[]) => void;
  setFilterOnPage: (docId: string, pageId: string, filter: PageFilter) => Promise<void>;
  setOcrText: (docId: string, pageId: string, text: string) => void;
  wipeLibrary: () => void;

  updateSettings: (patch: Partial<ScannerSettings>) => void;
  hydrateFromStorage: () => Promise<void>;
}

export const useScannerStore = create<ScannerState>((set, get) => ({
  view: "library",
  documents: initialDocuments(),
  activeDocumentId: null,
  capturePages: [],
  editingIndex: 0,
  reviewDocId: null,
  batchSavedCount: 0,
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  onboardingDone: false,
  completeOnboarding: () => {
    set({ onboardingDone: true });
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "1");
      }
    } catch {
      /* sin localStorage (SSR/privada): queda solo en memoria esta sesión */
    }
  },
  setView: (view) =>
    set((s) => ({
      view,
      // El lote termina al salir del ciclo cámara→editor (biblioteca o ajustes).
      batchSavedCount:
        view === "library" || view === "settings" ? 0 : s.batchSavedCount,
    })),
  openDocument: (id) => {
    const doc = get().documents.find((d) => d.id === id);
    // Un documento de la papelera nunca se abre en el editor desde la UI;
    // este guard evita carreras (p. ej. clic residual tras vaciarla).
    if (!doc || isTrashed(doc)) return;
    set({ activeDocumentId: id, batchSavedCount: 0 });
    get().beginReviewDocument(id);
  },

  pendingFindQuery: null,
  setPendingFindQuery: (q) => set({ pendingFindQuery: q }),

  /** Etiquetas — añade (si cabe y no existe) y persiste. */
  addTagToDocument: (id, tag) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return;
    const next = addTag(doc.tags ?? [], tag);
    if (!next) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: next, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  /** Etiquetas — quita y persiste. */
  removeTagFromDocument: (id, tag) => {
    const doc = get().documents.find((d) => d.id === id);
    if (!doc) return;
    const next = removeTag(doc.tags ?? [], tag);
    if (!next) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: next, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  /** Etiquetas — reemplaza la lista completa (edición en lote). */
  setDocumentTags: (id, tags) => {
    const clean = [...new Set(tags)].slice(0, 8);
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, tags: clean, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === id);
    if (updated) void persistDocument(updated);
  },

  addCapturePage: (page) =>
    set((s) => ({ capturePages: [...s.capturePages, page], editingIndex: s.capturePages.length })),
  removeCapturePage: (id) =>
    set((s) => {
      const idx = s.capturePages.findIndex((p) => p.id === id);
      const pages = s.capturePages.filter((p) => p.id !== id);
      return {
        capturePages: pages,
        editingIndex: Math.min(idx > 0 ? idx - 1 : 0, Math.max(0, pages.length - 1)),
      };
    }),
  updateCapturePage: (id, patch) =>
    set((s) => ({
      capturePages: s.capturePages.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  setEditingIndex: (i) => set({ editingIndex: i }),
  clearCaptureSession: () =>
    set({ capturePages: [], editingIndex: 0, reviewDocId: null }),

  startBatchDocument: () =>
    set((s) => ({
      batchSavedCount: s.batchSavedCount + 1,
      capturePages: [],
      editingIndex: 0,
      reviewDocId: null,
      view: "camera",
    })),
  endBatch: () => set({ batchSavedCount: 0 }),

  saveSessionAsDocument: async (title) => {
    const { capturePages } = get();
    if (capturePages.length === 0) return null;
    const now = Date.now();
    const pages: ScanPage[] = [];
    for (const p of capturePages) {
      let processed = p.original;
      let thumbnail = p.original;
      let precision: ScanPage["precision"];
      try {
        const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
          manual: p.quadManual === true,
        });
        processed = res.processed;
        thumbnail = res.thumbnail;
        precision = res.precision;
      } catch {
        /* usa original */
      }
      pages.push({
        id: p.id,
        original: p.original,
        processed,
        thumbnail,
        filter: p.filter,
        quad: p.quad,
        quadManual: p.quadManual,
        rotation: p.rotation,
        quality: p.quality,
        precision,
        ocrText: p.ocrText,
        ocrDone: p.ocrDone === true,
        createdAt: now,
      });
    }
    const doc: ScanDocument = {
      id: nextId("doc"),
      title: title.trim() || `Digitalización ${get().documents.length + 1}`,
      pages,
      favorite: false,
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({
      documents: [doc, ...s.documents],
      capturePages: [],
      editingIndex: 0,
    }));
    void persistDocument(doc);
    // El orden manual debe conocer al nuevo documento (si no, en el próximo
    // reload caería al final aunque aquí esté primero).
    void saveManualOrder(get().documents.map((d) => d.id));
    return doc;
  },

  // ── Modo revisión de documento (F-NOVIEW) ─────────────────────────────
  beginReviewDocument: (docId) => {
    const doc = get().documents.find((d) => d.id === docId);
    if (!doc || doc.pages.length === 0) return;
    set({
      // Las páginas conservan su id → el merge posterior sabe cuáles
      // existen (actualizar) y cuáles son nuevas (añadir). `processed` viaja
      // en la sesión con su `processedKey` (estado exacto con el que se
      // generó) → preview inmediato SOLO mientras la página no cambie.
      capturePages: doc.pages.map((p) => ({
        id: p.id,
        original: p.original,
        quad: p.quad,
        quadManual: p.quadManual,
        filter: p.filter,
        rotation: p.rotation,
        quality: p.quality,
        processed: p.processed,
        processedKey: capturePageKey(p),
        ocrText: p.ocrText,
        ocrDone: p.ocrDone,
      })),
      editingIndex: 0,
      reviewDocId: docId,
      view: "editor",
      batchSavedCount: 0,
    });
  },

  saveSessionToDocument: async () => {
    const { reviewDocId, capturePages } = get();
    if (!reviewDocId) return null;
    // B4: snapshot de ids a fusionar ANTES de los awaits — si el usuario
    // captura una página nueva mientras el merge corre (processImage es
    // async), NO debe borrarse con el vaciado final.
    const mergedIds = new Set(capturePages.map((p) => p.id));
    const doc = get().documents.find((d) => d.id === reviewDocId);
    if (!doc) {
      set({ capturePages: [], editingIndex: 0, reviewDocId: null });
      return null;
    }
    // Sesión vacía = el usuario eliminó la última página → elimina el doc.
    if (capturePages.length === 0) {
      get().deleteDocument(reviewDocId);
      set({ activeDocumentId: null });
      return null;
    }
    const now = Date.now();
    const byId = new Map(doc.pages.map((p) => [p.id, p] as const));
    const pages: ScanPage[] = [];
    for (const p of capturePages) {
      const prev = byId.get(p.id);
      // "Sin cambios" = mismos valores geometricos/foto → conserva la
      // procesada persistida (cero reprocesos innecesarios al salir).
      const geometrySame =
        prev !== undefined &&
        prev.original === p.original &&
        prev.filter === p.filter &&
        prev.rotation === p.rotation &&
        prev.quadManual === p.quadManual &&
        prev.quad.every((q, i) => q.x === p.quad[i].x && q.y === p.quad[i].y);
      if (geometrySame && prev) {
        pages.push({ ...prev, ocrText: p.ocrText ?? prev.ocrText, ocrDone: p.ocrDone ?? prev.ocrDone });
        continue;
      }
      // F-ROT-RAPID: la sesión trae una procesada VÁLIDA para el estado exacto
      // (processedKey == capturePageKey, generada por la rotación rápida del
      // editor) → NO re-procesar: se fusiona tal cual (la rotación de una
      // procesada es píxel-idéntica al reproceso completo). Solo se corrige la
      // precisión informativa si la rotación intercambió los ejes.
      const processedValid = !!p.processed && p.processedKey === capturePageKey(p);
      if (processedValid) {
        let precision = prev?.precision;
        if (precision && prev) {
          const d = (((p.rotation - prev.rotation) % 360) + 360) % 360;
          if (d === 90 || d === 270) {
            precision = { ...precision, width: precision.height, height: precision.width };
          } else if (d !== 0) {
            precision = undefined;
          }
        }
        pages.push({
          id: p.id,
          original: p.original,
          processed: p.processed!,
          thumbnail: p.thumbnail ?? prev?.thumbnail ?? p.original,
          filter: p.filter,
          quad: p.quad,
          quadManual: p.quadManual,
          rotation: p.rotation,
          quality: p.quality,
          precision,
          ocrText: p.ocrText ?? prev?.ocrText,
          ocrDone: p.ocrDone ?? false,
          createdAt: prev?.createdAt ?? now,
        });
        continue;
      }
      let processed = p.processed ?? p.original;
      let thumbnail = p.original;
      let precision: ScanPage["precision"];
      try {
        const res = await processImage(p.original, p.quad, p.filter, p.rotation, {
          manual: p.quadManual === true,
        });
        processed = res.processed;
        thumbnail = res.thumbnail;
        precision = res.precision;
      } catch {
        /* conserva la procesada anterior si la hay */
        if (prev) processed = prev.processed;
      }
      pages.push({
        id: p.id,
        original: p.original,
        processed,
        thumbnail,
        filter: p.filter,
        quad: p.quad,
        quadManual: p.quadManual,
        rotation: p.rotation,
        quality: p.quality,
        precision,
        // El OCR previo puede quedar desalineado tras re-recortar: se marca
        // como pendiente (no se borra el texto viejo — decide el usuario).
        ocrText: p.ocrText ?? prev?.ocrText,
        ocrDone: p.ocrDone ?? false,
        createdAt: prev?.createdAt ?? now,
      });
    }
    const updated: ScanDocument = { ...doc, pages, updatedAt: now };
    set((s) => ({
      documents: s.documents.map((d) => (d.id === reviewDocId ? updated : d)),
      // B4: solo se limpian las páginas fusionadas — las capturadas durante
      // el merge (ids no en el snapshot) sobreviven.
      capturePages: s.capturePages.filter((p) => !mergedIds.has(p.id)),
      editingIndex: 0,
      reviewDocId: null,
    }));
    void persistDocument(updated);
    return reviewDocId;
  },

  exitReviewToLibrary: async () => {
    const { reviewDocId } = get();
    if (!reviewDocId) {
      set({ view: "library" });
      return;
    }
    await get().saveSessionToDocument();
    set({ view: "library" });
  },

  deleteDocument: (id) => {
    // F-TRASH: borrado suave — el documento se marca con deletedAt y se
    // conserva en IndexedDB. La purga real solo ocurre a los 30 días (hydrate)
    // o desde la papelera (purgeDocument/emptyTrash).
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id && !isTrashed(d) ? { ...d, deletedAt: Date.now() } : d
      ),
      view: s.activeDocumentId === id ? "library" : s.view,
      activeDocumentId: s.activeDocumentId === id ? null : s.activeDocumentId,
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  restoreDocument: (id) => {
    set((s) => ({
      documents: s.documents.map((d) => {
        if (d.id !== id || !isTrashed(d)) return d;
        const { deletedAt: _gone, ...rest } = d;
        return { ...rest, updatedAt: Date.now() };
      }),
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  purgeDocument: (id) => {
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      view: s.activeDocumentId === id ? "library" : s.view,
      activeDocumentId: s.activeDocumentId === id ? null : s.activeDocumentId,
    }));
    void idbRemove(id);
    // Purga el id del orden manual persistido: sin esto los ids muertos se
    // acumulan en meta.manualOrder indefinidamente (solo wipeLibrary los
    // limpiaba) y cualquier lógica futura basada en el orden se confundiría.
    void saveManualOrder(get().documents.map((d) => d.id));
  },

  emptyTrash: () => {
    const trashedIds = get()
      .documents.filter((d) => isTrashed(d))
      .map((d) => d.id);
    if (trashedIds.length === 0) return;
    set((s) => ({ documents: s.documents.filter((d) => !isTrashed(d)) }));
    for (const id of trashedIds) void idbRemove(id);
    void saveManualOrder(get().documents.map((d) => d.id));
  },

  renameDocument: (id, title) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === id ? { ...d, title: title.trim() || d.title, updatedAt: Date.now() } : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  toggleFavorite: (id) => {
    set((s) => ({
      documents: s.documents.map((d) => (d.id === id ? { ...d, favorite: !d.favorite } : d)),
    }));
    const doc = get().documents.find((d) => d.id === id);
    if (doc) void persistDocument(doc);
  },

  addPageToDocument: async (docId, page) => {
    let processed = page.original;
    let thumbnail = page.original;
    let precision: ScanPage["precision"];
    try {
      const res = await processImage(page.original, page.quad, page.filter, page.rotation, {
        manual: page.quadManual === true,
      });
      processed = res.processed;
      thumbnail = res.thumbnail;
      precision = res.precision;
    } catch {
      /* usa original */
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: [
                ...d.pages,
                {
                  id: page.id,
                  original: page.original,
                  processed,
                  thumbnail,
                  filter: page.filter,
                  quad: page.quad,
                  quadManual: page.quadManual,
                  rotation: page.rotation,
                  quality: page.quality,
                  precision,
                  ocrText: undefined,
                  ocrDone: false,
                  createdAt: Date.now(),
                },
              ],
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  deletePageFromDocument: (docId, pageId) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? { ...d, pages: d.pages.filter((p) => p.id !== pageId), updatedAt: Date.now() }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  /** Reordena las páginas por ids (arrastrar y soltar en el carrusel). */
  reorderPages: (docId, order) => {
    const doc = get().documents.find((d) => d.id === docId);
    if (!doc) return;
    const byId = new Map(doc.pages.map((p) => [p.id, p]));
    const pages = order
      .map((id) => byId.get(id))
      .filter((p): p is ScanPage => p !== undefined);
    // Ignora órdenes incompletos o idénticos (evita escrituras vacías).
    if (pages.length !== doc.pages.length) return;
    if (pages.every((p, i) => p.id === doc.pages[i].id)) return;
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId ? { ...d, pages, updatedAt: Date.now() } : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === docId);
    if (updated) void persistDocument(updated);
  },

  /** Duplica un documento (menú contextual de la biblioteca). */
  duplicateDocument: (docId) => {
    const doc = get().documents.find((d) => d.id === docId);
    if (!doc) return;
    const now = Date.now();
    const { deletedAt: _trashed, ...live } = doc; // la copia nace viva
    const copy: ScanDocument = {
      ...live,
      id: nextId("doc"),
      title: `${doc.title} (copia)`.slice(0, 60),
      favorite: false,
      createdAt: now,
      updatedAt: now,
      pages: doc.pages.map((p) => ({ ...p })),
    };
    set((s) => ({ documents: [copy, ...s.documents] }));
    void persistDocument(copy);
    // Sincroniza el orden manual con la nueva membresía (misma razón que
    // saveSessionAsDocument).
    void saveManualOrder(get().documents.map((d) => d.id));
  },

  /** Orden manual: aplica la lista completa de ids (drag & drop de la vista
   *  de lista) y la persiste en el meta store (sobrevive al refresh). */
  setDocumentsOrder: (order) => {
    const byId = new Map(get().documents.map((d) => [d.id, d] as const));
    const next: ScanDocument[] = [];
    for (const id of order) {
      const d = byId.get(id);
      if (d) {
        next.push(d);
        byId.delete(id);
      }
    }
    // Los ids ausentes (nuevos mientras se arrastraba) van al final.
    for (const d of byId.values()) next.push(d);
    const same =
      next.length === get().documents.length &&
      next.every((d, i) => d.id === get().documents[i].id);
    if (same) return;
    set({ documents: next });
    void saveManualOrder(next.map((d) => d.id));
  },

  setFilterOnPage: async (docId, pageId, filter) => {
    const doc = get().documents.find((d) => d.id === docId);
    const page = doc?.pages.find((p) => p.id === pageId);
    if (!doc || !page) return;
    let processed = page.processed;
    let thumbnail = page.thumbnail;
    let precision: ScanPage["precision"] = page.precision;
    try {
      const res = await processImage(page.original, page.quad, filter, page.rotation, {
        manual: page.quadManual === true,
      });
      processed = res.processed;
      thumbnail = res.thumbnail;
      precision = res.precision;
    } catch {
      /* conserva */
    }
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: s.documents
                .find((dd) => dd.id === docId)!
                .pages.map((p) =>
                  p.id === pageId ? { ...p, filter, processed, thumbnail, precision } : p
                ),
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const updated = get().documents.find((d) => d.id === docId);
    if (updated) void persistDocument(updated);
  },

  setOcrText: (docId, pageId, text) => {
    set((s) => ({
      documents: s.documents.map((d) =>
        d.id === docId
          ? {
              ...d,
              pages: d.pages.map((p) =>
                p.id === pageId ? { ...p, ocrText: text, ocrDone: true } : p
              ),
              updatedAt: Date.now(),
            }
          : d
      ),
    }));
    const doc = get().documents.find((d) => d.id === docId);
    if (doc) void persistDocument(doc);
  },

  /** Borra TODOS los documentos (memoria + IndexedDB). Tras el refresh la
   *  biblioteca permanece vacía (la instalación queda marcada). */
  wipeLibrary: () => {
    set({ documents: [], activeDocumentId: null });
    void idbClearAll();
  },

  updateSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    saveSettings(settings);
  },

  /** Hidrata documentos + ajustes desde el almacenamiento local (§8).
 *  En instalación nueva conserva los mocks. Idempotente. */
  hydrateFromStorage: async () => {
    if (get().hydrated) return;
    const settings = loadSettings();
    const docs = await loadAllDocuments();
    // F-TRASH: purga automática de la papelera caducada (>30 días) al arrancar.
    // Se hace en memoria + IndexedDB (best-effort) — patrón «Eliminados
    // recientemente» de iOS Files.
    const now = Date.now();
    const live = (docs ?? get().documents).map((d) =>
      isTrashed(d) && now - (d.deletedAt ?? 0) > TRASH_RETENTION_DAYS * 86400000 ? null : d
    );
    const expired = live.filter((d): d is ScanDocument => d === null).length;
    const kept = live.filter((d): d is ScanDocument => d !== null);
    if (expired > 0) {
      for (const d of docs ?? []) {
        if (isTrashed(d) && now - (d.deletedAt ?? 0) > TRASH_RETENTION_DAYS * 86400000) {
          void idbRemove(d.id);
        }
      }
    }
    set((s) => ({
      hydrated: true,
      settings: { ...s.settings, ...settings },
      documents: docs === null ? s.documents : kept,
    }));
  },
}));

/** Selecciona el documento activo. */
export function useActiveDocument(): ScanDocument | null {
  return useScannerStore((s) => s.documents.find((d) => d.id === s.activeDocumentId) ?? null);
}

/** Sonda de QA (misma idea que __scannerPrecision/__cameraTelemetry):
 *  expone un resumen del store para verificar estado desde la consola. */
if (typeof window !== "undefined") {
  (window as unknown as { __scannerStore?: () => unknown }).__scannerStore = () => {
    const s = useScannerStore.getState();
    return {
      view: s.view,
      hydrated: s.hydrated,
      batchSavedCount: s.batchSavedCount,
      captureSession: {
        pages: s.capturePages.length,
        ids: s.capturePages.map((p) => p.id.slice(-8)),
      },
      documents: s.documents.map((d) => ({
        id: d.id,
        title: d.title,
        tags: d.tags ?? [],
        pages: d.pages.map((p) => ({
          id: p.id.slice(-8),
          ocrDone: p.ocrDone,
          chars: typeof p.ocrText === "string" ? p.ocrText.length : 0,
        })),
        updatedAt: d.updatedAt,
      })),
    };
  };
}
