// ============================================================
// OCR DE RUTEO E-14 — Clasificación guiada por catálogo (plan F4)
// ============================================================
// [T7] El catálogo (exterior-tree.json / lista de consulados) se usa
// como RESTRICCIÓN A PRIORI en vez de OCR-libre + match:
//   · el PAÍS se clasifica ENTRE los países del catálogo
//   · la MESA se elige ENTRE las mesas reales del puesto detectado
// Score de candidato = similitud por posición entre la lectura OCR
// y el candidato, ponderada por la confianza OCR POR DÍGITO
// (aproximada: la confianza global del campo repartida por posición,
// con los dígitos de la lectura como fuente).
//
// INVARIANTE (no adivinar): solo se acepta un candidato si el score
// máximo ≥ UMBRAL y la ventaja sobre el 2º ≥ MARGEN (unicidad
// plausible). Si no → sin sugerencia (fail-safe, contingencia).
// ============================================================

/** Resultado de la clasificación por catálogo. */
export interface ClasificacionCatalogo {
  /** Candidato elegido (código normalizado del catálogo) o null */
  elegido: string | null;
  /** Score del elegido 0–1 */
  score: number;
  /** Score del segundo mejor (para auditoría) */
  scoreSegundo: number;
  /** true → único candidato plausible (umbral + margen) */
  unico: boolean;
}

/** Umbral mínimo de score para aceptar (ej. 0.67 ≈ ≤1 dígito dudoso). */
const UMBRAL = 0.67;
/** Ventaja exigida sobre el 2º candidato para considerar único. */
const MARGEN = 0.15;

/**
 * Confianza por dígito aproximada: sin lecturas por posición de
 * Tesseract (el worker v5 no las expone baratas), se usa la
 * confianza del campo como base y se penaliza la POSICIÓN con el
 * patrón de error típico (extremos del recorte más ruidosos).
 */
function pesoPorPosicion(i: number, n: number): number {
  const base = 1;
  const borde = i === 0 || i === n - 1 ? 0.85 : 1;
  return base * borde;
}

/**
 * Similitud por posición entre la lectura y el candidato, ponderada
 * por la confianza OCR del campo. Ambos normalizados a dígitos.
 */
export function scoreCandidato(
  lectura: string,
  candidato: string,
  confianza: number
): number {
  const l = lectura.replace(/\D/g, "");
  const c = candidato.replace(/\D/g, "");
  if (!l || !c) return 0;
  if (l === c) return 1;
  if (l.length !== c.length) {
    // penalizar longitud distinta pero permitir comparación alineada a la derecha
    const pad = Math.abs(l.length - c.length);
    if (pad >= 2) return 0;
  }
  const n = Math.max(l.length, c.length);
  const lc = l.padStart(n, "0");
  const cc = c.padStart(n, "0");
  let acum = 0;
  let pesos = 0;
  for (let i = 0; i < n; i++) {
    const w = pesoPorPosicion(i, n);
    pesos += w;
    if (lc[i] === cc[i]) acum += w;
  }
  return pesos > 0 ? Math.max(0, Math.min(1, (acum / pesos) * (0.55 + 0.45 * confianza))) : 0;
}

/**
 * Clasifica la lectura ENTRE los candidatos del catálogo.
 * Devuelve el único candidato plausible (umbral + margen) o null.
 */
export function clasificarConCatalogo(
  lectura: string | null | undefined,
  candidatos: string[],
  confianza: number
): ClasificacionCatalogo {
  if (!lectura || candidatos.length === 0) {
    return { elegido: null, score: 0, scoreSegundo: 0, unico: false };
  }
  let mejor: string | null = null;
  let mejorScore = 0;
  let segundo = 0;
  for (const cand of candidatos) {
    const s = scoreCandidato(lectura, cand, confianza);
    if (s > mejorScore) {
      segundo = mejorScore;
      mejor = cand;
      mejorScore = s;
    } else if (s > segundo) {
      segundo = s;
    }
  }
  const unico = mejor != null && mejorScore >= UMBRAL && mejorScore - segundo >= MARGEN;
  return {
    elegido: unico ? mejor : null,
    score: mejorScore,
    scoreSegundo: segundo,
    unico,
  };
}

// ------------------------------------------------------------
// [T12] Rescate anti-transposición por ÚNICO anagrama
// ------------------------------------------------------------

/** Multiconjunto de dígitos idéntico (misma longitud y mismos dígitos). */
function mismoMulticonjunto(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  // SIGNED (Int16Array): con Uint8Array el decremento bajo 0 da wraparound
  // (0-1 → 255) y el chequeo `cuenta[d] < 0` NUNCA dispara — todo parecía
  // anagrama de todo y la unicidad del rescate moría (bug medido en el
  // golden: "115"/"120"/… falsos anagramas de "533" → sin rescate).
  const cuenta = new Int16Array(10);
  for (let i = 0; i < a.length; i++) cuenta[a.charCodeAt(i) - 48]++;
  for (let i = 0; i < b.length; i++) {
    const d = b.charCodeAt(i) - 48;
    cuenta[d]--;
    if (cuenta[d] < 0) return false;
  }
  return true;
}

/**
 * [T12] Rescate anti-transposición (mesa 001→100, país 335→533 — el
 * patrón de error dominante medido): devuelve la ÚNICA opción del
 * catálogo que es ANAGRAMA de la lectura (misma longitud, mismo
 * multiconjunto de dígitos, lectura ≠ opción).
 *
 * INVARIANTE (no adivinar): si hay 2+ anagramas posibles → null (sin
 * rescate); si la lectura ya es una opción exacta → null (nada que
 * rescatar). Es el rescate MÁS ESTRECHO posible: exige unicidad
 * estructural y no abre la puerta a Levenshtein-2 general (entre ~95
 * países nunca es único → adivinanza, PROHIBIDO).
 */
export function unicoAnagrama(
  lectura: string | null | undefined,
  opciones: string[]
): string | null {
  if (!lectura || opciones.length === 0) return null;
  const l = lectura.replace(/\D/g, "");
  if (!l) return null;
  let unico: string | null = null;
  for (const opcion of opciones) {
    const o = opcion.replace(/\D/g, "");
    if (o.length !== l.length || o === l) continue;
    if (!mismoMulticonjunto(l, o)) continue;
    if (unico !== null) return null; // 2+ anagramas → sin rescate
    unico = opcion;
  }
  return unico;
}
