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
