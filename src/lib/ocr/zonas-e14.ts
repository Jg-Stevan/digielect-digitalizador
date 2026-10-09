// ============================================================
// OCR DE RUTEO E-14 — Zonas del formulario (solo campos IMPRESOS)
// ============================================================
// REGLA DE PRODUCTO (grabada): los VOTOS (campos manuscritos) NO se
// leen. Estas zonas cubren ÚNICAMENTE los campos impresos de ruteo
// del encabezado del E-14 exterior. Las zonas manuscritas ni se
// declaran.
//
// Layout verificado contra 2 actas reales (calibración VLM sobre
// recortes físicos — valores leídos: CONSULADO 88, PAÍS 335/495,
// ZONA 05/10, PUESTO 02, MESA 001 en todas las cajas):
//
//   CONSULADO: 88 - CONSULADOS      ← "departamento" (constante 88
//                                     en el E-14 exterior)
//   PAÍS: 335 - EGIPTO              ← "municipio" (código de país
//                                     — variable de ruteo real)
//   ZONA: 05  PUESTO: 02  MESA: 001 ← una sola línea impresa
//   LUGAR: El Cairo - Consulado
//
// El catálogo de mesas resuelve: codigo = "{pais}-{zona}-{puesto}"
// (ej. "335-05-02" = El Cairo) + mesa.numero → mesaId.
// El campo "departamento" (88 constante) NO participa del match:
// se lee como control, no como clave.
//
// [PLAN-MEJORA v1.1 · F1.5] Señales impresas baratas: el acta trae
// impreso lo que hoy se sufre decodificando. Dos zonas de PISTA más
// el banner del ejemplar:
//   · barcodeImpreso [0.20, 0.040, 0.80, 0.018] — los 15 dígitos
//     bajo el código de barras + "Ver: 01 Pag: 1 de 2" en la misma
//     línea → tipo/página/kit/versión SIN decodificar barras.
//   · footer [0.0, 0.93, 1.0, 0.07] — "No. Form: 399 · KIT 399 ·
//     Civ 797/798" → cruce KIT↔barcode y voto de página vía mapa
//     aprendido por kit (NUNCA regla dura).
//   · banner (banda oscura detectada dinámicamente, pasada INVERTIDA
//     blanco-sobre-negro) → "TRANSMISION" vs "CÓNSUL/EMBAJADOR".
// Cajas medidas sobre el corpus Kit 399 (200 dpi, ver
// tests/golden/esperado-ocr.json → zonasPistas) — regex tolerantes
// al ruido medido ("Pagit", "Pana", "Pag: tde2", "Ci[vv]").
// ============================================================

/** Una zona OCR de ruteo sobre el acta rectificada. */
export interface ZonaOcr {
  id: "departamento" | "municipio" | "zona" | "puesto" | "mesa";
  label: string;
  /** x, y, w, h en fracciones 0–1 del acta rectificada. */
  box: [number, number, number, number];
  /** Caracteres permitidos (filtro de reconocimiento). */
  whitelist: string;
  /** Confianza mínima 0–1 para aceptar el campo. */
  confMinima: number;
  /** Relleno a ceros a la izquierda del valor normalizado. */
  digitos: number;
}

/** [F1.5] Una zona de PISTA impresa: texto libre + patrón esperado.
 *  No participa del ruteo por catálogo: alimenta la clasificación
 *  del ejemplar (tipo/página/kit) con votos y cruces. */
export interface ZonaPistaOcr {
  id: "barcodeImpreso" | "footer";
  label: string;
  box: [number, number, number, number];
  whitelist: string;
  /** Modo de segmentación de Tesseract (línea=7, bloque=6). */
  psm: 6 | 7;
}

/** Zonas de ruteo del E-14 exterior (calibradas con actas reales).
 *
 * Calibración medida (warp marco-completo + modo text + PSM 7 +
 * whitelist dígitos, escala de recorte ×3):
 *  · E14…88_335_005_02_000 → 88 · 335 · 05 · 02 · 001 (5/5 ✓)
 *  · E14…88_495_010_02_000 → 88 · 495 · 10 · 02 · 001 (5/5 ✓)
 *  · Las actas de impresión más degradada (335_005_81, 355_003_08)
 *    fallan la validación estructural/católogo → contingencia (fail-safe).
 */
export const ZONAS_RUTEO_E14: ZonaOcr[] = [
  {
    id: "departamento",
    label: "CONSULADO",
    // CONSULADO: 88 — constante en el E-14 exterior (control, no clave)
    box: [0.23, 0.145, 0.08, 0.014],
    whitelist: "0123456789",
    confMinima: 0.72,
    digitos: 2,
  },
  {
    id: "municipio",
    label: "PAÍS",
    // PAÍS: 335 — código del país (clave 1 del catálogo)
    box: [0.12, 0.158, 0.1, 0.014],
    whitelist: "0123456789",
    confMinima: 0.72,
    digitos: 3,
  },
  {
    id: "zona",
    label: "ZONA",
    // ZONA: 05 (clave 2 del catálogo)
    box: [0.148, 0.171, 0.065, 0.014],
    whitelist: "0123456789",
    confMinima: 0.72,
    digitos: 2,
  },
  {
    id: "puesto",
    label: "PUESTO",
    // PUESTO: 02 (clave 3 del catálogo)
    box: [0.315, 0.171, 0.065, 0.014],
    whitelist: "0123456789",
    confMinima: 0.72,
    digitos: 2,
  },
  {
    id: "mesa",
    label: "MESA",
    // MESA: 001 (número de mesa dentro del puesto)
    box: [0.465, 0.171, 0.09, 0.014],
    whitelist: "0123456789",
    confMinima: 0.72,
    digitos: 3,
  },
];

/**
 * [T2 · PLAN F1] Orden de PROCESAMIENTO de las zonas: mesa → puesto →
 * zona → municipio → departamento. El presupuesto de 5 s se gasta
 * primero donde el feedback del jurado es más importante (la mesa es
 * el campo de mayor prioridad; el departamento 88 es constante de
 * control). El array ZONAS_RUTEO_E14 queda en orden de documento; el
 * motor lo reordena con esta lista.
 */
export const ORDEN_LECTURA_RUTEO: Array<ZonaOcr["id"]> = [
  "mesa",
  "puesto",
  "zona",
  "municipio",
  "departamento",
];

/**
 * [F1.5] Zonas de pistas impresas (cajas medidas en corpus Kit 399
 * 200 dpi — tests/golden/esperado-ocr.json → zonasPistas). Regex
 * TOLERANTES en senales-impresas.ts (lo que de verdad sale del OCR:
 * "Pagit", "Pana", "Pag: tde2", "Ci[vv] 797").
 */
export const ZONAS_PISTAS_E14: ZonaPistaOcr[] = [
  {
    id: "barcodeImpreso",
    label: "BARCODE IMPRESO",
    // Línea de dígitos bajo el código de barras + "Ver: 01 Pag: 1 de 2"
    box: [0.2, 0.04, 0.8, 0.018],
    whitelist: "0123456789VEDPAGvedpag.:· ",
    psm: 7,
  },
  {
    id: "footer",
    label: "PIE DE FORMA",
    // "No. Form: 399 · KIT 399 · Civ 797/798"
    box: [0.0, 0.93, 1.0, 0.07],
    whitelist: "0123456789KITCIVONoFormkitcivon.:/· ",
    psm: 6,
  },
];
