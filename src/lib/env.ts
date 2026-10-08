// ============================================================
// DIGITALIZADOR E-14 — Entorno de compilación (client-safe)
// Repo estático: SIEMPRE export para GitHub Pages. Resuelve rutas
// públicas con el basePath del despliegue y expone el host de la
// API del supervisor (digielect).
// ============================================================

/** Repo estático: SIEMPRE export (compat con el código migrado de digielect). */
export const IS_STATIC_EXPORT = true;

/** Prefijo de ruta del despliegue (default "/digielect-digitalizador"; vacío = raíz). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "/digielect-digitalizador";

/**
 * Host con Node de digielect (supervisor + API de ingesta).
 * Vacío → modo local puro: cola offline sin upload (válido para
 * pruebas). Ej.: "https://digielect.example.com"
 */
export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Antepone el basePath a una ruta pública absoluta.
 */
export function withBasePath(path: string): string {
  if (!path.startsWith("/")) return path;
  return `${BASE_PATH}${path}`;
}

/**
 * Resuelve una ruta de la API del supervisor contra el host
 * configurado. Sin host → devuelve null (modo local puro).
 */
export function rutaApi(path: string): string | null {
  if (!API_BASE_URL) return null;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
