"use client";

// ============================================================
// OCR E-14 — Telemetría local de fallos por campo (plan F0)
// ============================================================
// Guarda en IndexedDB (store "metricas-batch", offline estricto)
// cada campo de ruteo/identificación con su valor, confianza y si
// pasó la validación — con EXPORT en JSON para calibrar las cajas
// por lotes. Nunca sale del dispositivo salvo export explícito.
// ============================================================

import { idbAll, idbPut } from "@/lib/idb";

/** Store de idb.ts reutilizado para métricas. */
const STORE_TELEMETRIA = "metricas-batch" as const;
const PREFIJO = "tel-";

export interface RegistroTelemetria {
  id: string;
  ts: number;
  /** "ruteo:mesa" | "ruteo:pais" | "identificacion" | "pistas" */
  fuente: string;
  /** Campo concreto (mesa, municipio, zona, puesto, departamento…) */
  campo: string;
  valor: string | null;
  confianza: number;
  /** true → el campo pasó su validación estructural/catálogo */
  ok: boolean;
  /** Motivo del fallo (para el informe de calibración) */
  motivo?: string | null;
}

/** Registra una medición (fire-and-forget, nunca lanza). */
export function registrarTelemetria(
  r: Omit<RegistroTelemetria, "id" | "ts">,
): void {
  try {
    void idbPut(STORE_TELEMETRIA, {
      ...r,
      id: `${PREFIJO}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
    });
  } catch {
    /* sin IndexedDB (modo privado): la telemetría se pierde, no importa */
  }
}

/** Lee todas las mediciones (más nuevas primero). */
export async function leerTelemetria(): Promise<RegistroTelemetria[]> {
  try {
    const filas = await idbAll<RegistroTelemetria & { id: string }>(STORE_TELEMETRIA);
    return filas
      .filter((f) => String(f.id ?? "").startsWith(PREFIJO))
      .sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

/** Exporta la telemetría como JSON descargable (para calibración). */
export async function exportarTelemetria(): Promise<number> {
  const filas = await leerTelemetria();
  const informe = {
    generado: new Date().toISOString(),
    total: filas.length,
    resumen: resumenFallos(filas),
    filas,
  };
  const blob = new Blob([JSON.stringify(informe, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `telemetria-ocr-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2_000);
  return filas.length;
}

/** Agregado de fallos por campo (tasa de ok y confianza media). */
export function resumenFallos(
  filas: RegistroTelemetria[],
): Record<string, { total: number; ok: number; confMedia: number }> {
  const out: Record<string, { total: number; ok: number; confMedia: number }> = {};
  for (const f of filas) {
    const clave = `${f.fuente}:${f.campo}`;
    const e = (out[clave] ??= { total: 0, ok: 0, confMedia: 0 });
    e.total += 1;
    if (f.ok) e.ok += 1;
    e.confMedia += f.confianza;
  }
  for (const e of Object.values(out)) {
    e.confMedia = e.total > 0 ? Math.round((e.confMedia / e.total) * 100) / 100 : 0;
  }
  return out;
}

/** Expon el export en consola para calibración manual por lotes. */
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__digielectExportarTelemetria =
    exportarTelemetria;
}
