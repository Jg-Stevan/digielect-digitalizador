/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
"use client";

/**
 * Persistencia local §8 del usuario (ARQUITECTURA-Y-PRECISION.md):
 *  - Documentos completos en IndexedDB con las imágenes como BLOB (no data
 *    URLs) — mucho más compactos en disco y nativos del navegador.
 *  - Ajustes en localStorage (payload diminuto, sync al boot).
 *
 * Toda la API degrada en silencio: sin IndexedDB (SSR, modo privado, Safari
 * viejo) la app sigue funcionando 100% en memoria. Nunca lanza.
 */

import type { ScanDocument, ScanPage, ScannerSettings } from "./types";
import { DEFAULT_SETTINGS, normalizePageFilter } from "./types";

const DB_NAME = "escaner-ios";
const DB_VERSION = 2;
const STORE_DOCS = "documents";
const STORE_META = "meta";
const META_KEY = "initialized";
const META_KEY_ORDER = "manualOrder";
const SETTINGS_KEY = "escaner-settings-v1";
/** Marca de migración one-time: sube exportQuality a "máxima" para
 *  instalaciones creadas antes del cambio de calidad por defecto (F-OCR).
 *  Si el usuario elige otro valor DESPUÉS de migrar, se respeta siempre. */
const SETTINGS_MIGRATION_KEY = "escaner-settings-v2-maxq";
/** F-OCR-MANUAL v6.1: clave aparte para que la migración del OCR corra una
 *  vez en TODAS las instalaciones (la clave v2-maxq ya está escrita en las
 *  anteriores y no volvería a ejecutarse). */
const SETTINGS_MIGRATION_KEY_OCR_OFF = "escaner-settings-v3-ocr-manual";

/** Registro persistido: igual que ScanPage pero con las imágenes como Blob. */
interface StoredPage extends Omit<ScanPage, "original" | "processed" | "thumbnail"> {
  original: Blob;
  processed: Blob;
  thumbnail: Blob;
}

interface StoredDocument extends Omit<ScanDocument, "pages"> {
  pages: StoredPage[];
}

// ─── utilidades data URL ⇄ Blob ─────────────────────────────────────────────

export function dataUrlToBlob(dataUrl: string): Blob {
  // Sin fetch() (más portable en workers/contextos fríos): parse manual.
  // Soporta DOS variantes de data URL:
  //  · base64 (image/png, image/jpeg de los escaneos reales)
  //  · percent-encoded (data:image/svg+xml;charset=utf-8,… de los mocks demo)
  // atob() sobre SVG percent-encoded lanza InvalidCharacterError — antes se
  // tragaba el error en el catch de persistDocument y los cambios sobre
  // documentos demo (renombrar, favorito, etiquetas…) NO persistían.
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return new Blob();
  const header = dataUrl.slice(0, comma);
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? "application/octet-stream";
  const payload = dataUrl.slice(comma + 1);
  if (/;base64$/i.test(header)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  const text = decodeURIComponent(payload);
  return new Blob([text], { type: mime });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("blobToDataUrl falló"));
    fr.readAsDataURL(blob);
  });
}

// ─── IndexedDB (documentos) ─────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Marca la instalación como inicializada (la biblioteca real ya existe). */
async function markInitialized(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE_META, "readwrite");
  tx.objectStore(STORE_META).put(true, META_KEY);
  await txDone(tx);
}

async function readInitialized(db: IDBDatabase): Promise<boolean> {
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_META, "readonly");
    const req = tx.objectStore(STORE_META).get(META_KEY);
    req.onsuccess = () => resolve(req.result === true);
    req.onerror = () => resolve(false);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("tx error"));
    tx.onabort = () => reject(tx.error ?? new Error("tx abort"));
  });
}

/** Guarda (o reemplaza) un documento completo con imágenes como Blob. */
export async function persistDocument(doc: ScanDocument): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const record: StoredDocument = {
      ...doc,
      pages: doc.pages.map((p) => ({
        ...p,
        original: dataUrlToBlob(p.original),
        processed: dataUrlToBlob(p.processed),
        thumbnail: dataUrlToBlob(p.thumbnail),
      })),
    };
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).put(record);
    await txDone(tx);
    await markInitialized(db);
    db.close();
  } catch {
    /* persistencia best-effort: la app sigue en memoria */
  }
}

/** Elimina un documento por id. */
export async function removeDocument(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).delete(id);
    await txDone(tx);
    db.close();
  } catch {
    /* noop */
  }
}

/** Vacía todos los documentos persistedos y deja la instalación marcada
 *  (tras “Borrar todos” el refresh muestra biblioteca vacía, no los mocks). */
export async function clearAllDocuments(): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_DOCS, "readwrite");
    tx.objectStore(STORE_DOCS).clear();
    await txDone(tx);
    const mtx = db.transaction(STORE_META, "readwrite");
    mtx.objectStore(STORE_META).delete(META_KEY_ORDER);
    await txDone(mtx);
    await markInitialized(db);
    db.close();
  } catch {
    /* noop */
  }
}

/** Guarda el orden manual de la biblioteca (lista completa de ids). */
export async function saveManualOrder(ids: string[]): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    const tx = db.transaction(STORE_META, "readwrite");
    tx.objectStore(STORE_META).put(ids, META_KEY_ORDER);
    await txDone(tx);
    db.close();
  } catch {
    /* noop */
  }
}

/** Lee el orden manual guardado ([] si nunca se reordenó). */
export async function loadManualOrder(): Promise<string[]> {
  try {
    const db = await openDb();
    if (!db) return [];
    const ids = await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE_META, "readonly");
      const req = tx.objectStore(STORE_META).get(META_KEY_ORDER);
      req.onsuccess = () =>
        resolve(Array.isArray(req.result) ? (req.result as string[]) : []);
      req.onerror = () => resolve([]);
    });
    db.close();
    return ids;
  } catch {
    return [];
  }
}

/** Carga todos los documentos (Blobs → data URLs para la UI).
 *  null = instalación nueva (sin persistir) → la app conserva los mocks.
 *  []   = biblioteca real vacía (p. ej. tras borrar todo). */
export async function loadAllDocuments(): Promise<ScanDocument[] | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    const initialized = await readInitialized(db);
    if (!initialized) {
      db.close();
      return null;
    }
    const docs = await new Promise<StoredDocument[]>((resolve, reject) => {
      const tx = db.transaction(STORE_DOCS, "readonly");
      const req = tx.objectStore(STORE_DOCS).getAll();
      req.onsuccess = () => resolve(req.result as StoredDocument[]);
      req.onerror = () => reject(req.error ?? new Error("getAll error"));
    });
    db.close();
    const out: ScanDocument[] = [];
    for (const d of docs) {
      const pages: ScanPage[] = [];
      for (const sp of d.pages) {
        try {
          pages.push({
            ...sp,
            // §8.4 — migración legacy: los usuarios viejos tienen los 8
            // presets persistidos; al hidratar se normaliza al de hoy.
            filter: normalizePageFilter(sp.filter),
            original: await blobToDataUrl(sp.original),
            processed: await blobToDataUrl(sp.processed),
            thumbnail: await blobToDataUrl(sp.thumbnail),
          });
        } catch {
          /* página corrupta → se omite */
        }
      }
      if (pages.length > 0) out.push({ ...d, pages });
    }
    // Más recientes primero por defecto; si hay orden manual guardado, ese
    // gana (los ids desconocidos/nuevos van al final por fecha).
    const order = await loadManualOrder();
    if (order.length > 0) {
      const pos = new Map(order.map((id, i) => [id, i] as const));
      out.sort((a, b) => {
        const pa = pos.get(a.id);
        const pb = pos.get(b.id);
        if (pa !== undefined && pb !== undefined) return pa - pb;
        if (pa !== undefined) return -1;
        if (pb !== undefined) return 1;
        return b.updatedAt - a.updatedAt;
      });
    } else {
      out.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return out;
  } catch {
    return null;
  }
}

// ─── localStorage (ajustes) ──────────────────────────────────────────────────

export function saveSettings(settings: ScannerSettings): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* noop */
  }
}

export function loadSettings(): ScannerSettings {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ScannerSettings>;
    // Merge defensivo: defaults para claves nuevas/ausentes.
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    // Migración one-time: instalaciones previas guardaron "alta" como
    // default — se eleva a "máxima" una sola vez (después de esto el
    // valor persistido vuelve a ser sagrado).
    if (!localStorage.getItem(SETTINGS_MIGRATION_KEY)) {
      if (parsed.exportQuality === "alta") merged.exportQuality = "máxima";
      localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
    }
    // Migración one-time v6.1: OCR automático → OFF (bajo demanda, botón
    // «Texto» del editor). Tras esta única pasada el valor persistido
    // vuelve a ser sagrado: si el usuario lo re-activa, se respeta.
    if (!localStorage.getItem(SETTINGS_MIGRATION_KEY_OCR_OFF)) {
      merged.ocrEnabled = false;
      localStorage.setItem(SETTINGS_MIGRATION_KEY_OCR_OFF, "1");
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** ¿Hay persistencia disponible? (para la fila informativa de Ajustes) */
export function storageAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}
