"use client";

// ============================================================
// DIGITALIZADOR E-14 — Banner "Nueva versión disponible" (Fase 8)
// Se muestra cuando el SW detectó una actualización lista. El
// operario decide cuándo reiniciar (jamás un reload sorpresa a
// mitad de jornada). Safe-areas iOS respetadas.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";

export function ActualizarAppBanner() {
  const [disponible, setDisponible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sondear = () => setDisponible(window.__swActualizar?.fase === "lista");
    window.__swAvisar = sondear;
    sondear();
    return () => {
      window.__swAvisar = undefined;
    };
  }, []);

  const aplicar = useCallback(() => {
    setDisponible(false);
    const estado = window.__swActualizar;
    if (estado && estado.fase === "lista") estado.aplicar();
  }, []);

  if (!disponible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[90] flex items-center justify-between gap-3 border-b border-emerald-500/40 bg-emerald-600 px-4 py-2.5 text-white shadow-lg"
      style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
    >
      <p className="min-w-0 text-[12px] font-bold uppercase tracking-wider">
        Nueva versión disponible — Reiniciar para aplicar
      </p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={aplicar}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-[11px] font-extrabold uppercase tracking-wider transition-colors hover:bg-white/25 active:scale-95"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          REINICIAR
        </button>
        <button
          type="button"
          aria-label="Posponer actualización"
          onClick={() => setDisponible(false)}
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 transition-colors hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
