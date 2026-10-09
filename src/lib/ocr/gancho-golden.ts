"use client";

// ============================================================
// OCR E-14 — GANCHO PARA GOLDEN TESTS (plan-mejora F0 · T0)
// ============================================================
// Expone el pipeline OCR REAL (los mismos módulos que usa la app)
// en window.__digielectOcrGolden para que tests/ocr-golden.spec.mjs
// lo invoque desde el navegador contra las actas de corpus. NO
// añade ni altera lógica: es un espejo de solo lectura. Los tests
// corren contra localhost (dispositivo de calibración), nunca vía
// red: el offline estricto no se ve afectado.
// ============================================================

import { reconocerZonasRuteo, reconocerPistas, workerOcrRuteo } from "@/lib/ocr/motor-ocr";
import { resolverRuteo } from "@/lib/ocr/ruteo";
import { ZONAS_RUTEO_E14, ZONAS_PISTAS_E14 } from "@/lib/ocr/zonas-e14";
import { clasificarEjemplar, identificarActa, crearIndiceActas } from "@/lib/identificacion-acta";
import { parsearBarcodeImpreso, parsearFooter, tipoDesdeBanner } from "@/lib/ocr/senales-impresas";
import { clasificarConCatalogo } from "@/lib/ocr/ruteo-catalogo";

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__digielectOcrGolden = {
    reconocerZonasRuteo,
    reconocerPistas,
    workerOcrRuteo,
    resolverRuteo,
    clasificarEjemplar,
    identificarActa,
    crearIndiceActas,
    clasificarConCatalogo,
    parsearBarcodeImpreso,
    parsearFooter,
    tipoDesdeBanner,
    ZONAS_RUTEO_E14,
    ZONAS_PISTAS_E14,
  };
}
