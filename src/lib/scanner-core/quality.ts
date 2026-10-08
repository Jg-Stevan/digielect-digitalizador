/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
"use client";

/**
 * Score de calidad de captura + máquina de disparo — PORT fiel de
 * `src/scanner/core/quality.ts` del usuario (logica-deteccion.zip).
 *
 * Módulo PURO: recibe números crudos (varianza laplaciana, histograma,
 * historial de quads con timestamps) y produce scores. Constantes intactas
 * (validadas empíricamente en SM-A566E + iPhone según la doc original):
 *  · total = (0.4·sharpness + 0.3·exposure + 0.3·stability) × eccentricity
 *  · disparo k-de-n: score > 0.8, K=4 de N=6 dentro de 1200 ms y última buena
 *  · estabilidad: ventana 600 ms POR TIMESTAMP (el descarte de frames hace
 *    que el índice mienta), varianza normalizada a 20 px² a 400-clase
 *
 * Desviación documentada: el histograma de exposición se mide sobre un
 * miniatura del frame COMPLETO (96 px) en el main thread — el worker solo
 * devuelve cropMean/cropStdDev (RawQualityInput); con papel dominante el
 * frame ≈ crop y la fórmula del usuario queda intacta.
 */

import type { Quad } from "./types";

// ─── Constantes DADAS (NO recalcular — origen: quality.ts del usuario) ──────

/** v3 §5-F2: ponderación del score compuesto. */
export const WEIGHTS = { sharpness: 0.4, exposure: 0.3, stability: 0.3 } as const;

/** Saturación de Var(Laplacian) medida sobre el crop a 400-clase. */
export const SHARPNESS_NORM = 300;

/** isBlur si la varianza cruda < 100 (compara la VARIANZA, no el score). */
export const BLUR_THRESHOLD = 100.0;

/** Píxel con valor < 30 cuenta como subexpuesto. */
export const UNDER_EXPOSED_PX = 30;

/** Píxel con valor > 225 cuenta como sobreexpuesto. */
export const OVER_EXPOSED_PX = 225;

/** Píxel con valor > 248 = especular, info IRRECUPERABLE. */
export const SPECULAR_PX = 248;

/** >3% de píxeles especulares → warning "evita el reflejo". */
export const SPECULAR_RATIO_WARN = 0.03;

/** Varianza de posiciones de quads (px²) normalizada a 400-clase. */
export const STABILITY_VAR_NORM = 20.0;

/** Ventana TEMPORAL de estabilidad en ms (por timestamp, no por índice). */
export const STABILITY_WINDOW_MS = 600;

/** Trigger de disparo: score compuesto por encima de 0.8. */
export const SHUTTER_SCORE = 0.8;

/** F2-c: K buenas requeridas de las últimas N muestras dentro de SPAN. */
export const SHUTTER_K = 4;
export const SHUTTER_N = 6;
export const SHUTTER_SPAN_MS = 1200;

/** F-STAB — ventana sostenida mínima entre la primera y la última muestra del
 *  conjunto k-de-n: si las muestras llegaron más rápido, el teléfono aún se
 *  está acomodando (falso positivo por alta velocidad) y NO se dispara. */
export const SHUTTER_SUSTAIN_MS = 260;

/** Sin detección >8s → escape a captura manual. */
export const NO_DETECT_TIMEOUT_MS = 8000;

/** B9: máximo de avisos «No detecto el documento» por sesión (antes sonaba
 *  cada 8 s toda la sesión; con tope 2 deja de ser ruido). */
export const MAX_NO_DETECT_NOTICES = 2;

/** Cooldown post-captura anti doble-disparo (ms). */
export const CAPTURE_COOLDOWN_MS = 1500;

/** Margen de excentricidad: fracción del lado corto del frame. */
export const ECCENTRICITY_MARGIN = 0.05;

// ─── Tipos ──────────────────────────────────────────────────────────────────

/** Entrada del historial de estabilidad: timestamp + quad medido (px proceso). */
export interface QuadSample {
  t: number;
  quad: Quad;
}

/** Entrada del historial de disparo: timestamp + score compuesto. */
export interface ScoreSample {
  t: number;
  score: number;
}

/** Resultado de la métrica de exposición. */
export interface ExposureResult {
  score: number;
  specularRatio: number;
  specularWarn: boolean;
}

/** Score compuesto completo (todos los componentes 0–1). */
export interface QualityScore {
  sharpness: number;
  exposure: number;
  stability: number;
  eccentricity: number;
  specular: number;
  total: number;
  isBlur: boolean;
}

// ─── Componentes ────────────────────────────────────────────────────────────

/** Nitidez 0–1: saturación lineal de Var(Laplacian) del crop a 400-clase. */
export function computeSharpnessScore(laplacianVar: number): number {
  if (!Number.isFinite(laplacianVar) || laplacianVar <= 0) return 0;
  return Math.min(1, laplacianVar / SHARPNESS_NORM);
}

/**
 * Exposición 0–1 desde el histograma de 256 bins (fórmula exacta del
 * usuario): score = 1 − (under + over)/total; specular = fracción > 248.
 */
export function computeExposureScore(hist: number[]): ExposureResult {
  let total = 0;
  let under = 0;
  let over = 0;
  let specular = 0;
  const n = Math.min(hist.length, 256);
  for (let i = 0; i < n; i++) {
    const c = hist[i] ?? 0;
    if (!(c > 0)) continue;
    total += c;
    if (i < UNDER_EXPOSED_PX) under += c;
    else if (i > OVER_EXPOSED_PX) over += c;
    if (i > SPECULAR_PX) specular += c;
  }
  if (total <= 0) return { score: 0, specularRatio: 0, specularWarn: false };
  const specularRatio = specular / total;
  const score = Math.min(1, Math.max(0, 1 - (under + over) / total));
  return { score, specularRatio, specularWarn: specularRatio > SPECULAR_RATIO_WARN };
}

/**
 * Estabilidad 0–1: 1 − clamp(meanVar / 20). Solo entran muestras con
 * `nowMs − t` dentro de la ventana de 600 ms (POR TIMESTAMP). meanVar =
 * media de las varianzas poblacionales de las 8 coordenadas (px² a
 * 400-clase). <2 muestras en ventana → 0.
 */
export function computeStabilityScore(history: QuadSample[], nowMs: number): number {
  const inWindow = history.filter(
    (s) => nowMs - s.t >= 0 && nowMs - s.t <= STABILITY_WINDOW_MS
  );
  if (inWindow.length < 2) return 0;
  const n = inWindow.length;
  const means = new Array<number>(8).fill(0);
  for (const s of inWindow) {
    for (let i = 0; i < 4; i++) {
      means[2 * i]! += s.quad[i]!.x / n;
      means[2 * i + 1]! += s.quad[i]!.y / n;
    }
  }
  let acc = 0;
  for (const s of inWindow) {
    for (let i = 0; i < 4; i++) {
      const dx = s.quad[i]!.x - means[2 * i]!;
      const dy = s.quad[i]!.y - means[2 * i + 1]!;
      acc += (dx * dx + dy * dy) / n;
    }
  }
  const meanVar = acc / 8;
  return Math.min(1, Math.max(0, 1 - meanVar / STABILITY_VAR_NORM));
}

/**
 * Excentricidad 0–1: margin = 5% del lado corto; por esquina
 * dMin = min(x, W−x, y, H−y); score = clamp(dMin/margin). Retorno = MÍN de
 * las 4 (la peor domina). Penaliza documento pegado al borde del encuadre.
 * Entrada en fracciones 0–1 (se escala a px del frame).
 */
export function computeEccentricityScore(
  quad: Quad,
  frameW: number,
  frameH: number
): number {
  const shortSide = Math.min(frameW, frameH);
  if (!Number.isFinite(shortSide) || shortSide <= 0) return 0;
  const margin = ECCENTRICITY_MARGIN * shortSide;
  let worst = 1;
  for (let i = 0; i < 4; i++) {
    const c = quad[i]!;
    const px = c.x * frameW;
    const py = c.y * frameH;
    const dMin = Math.min(px, frameW - px, py, frameH - py);
    const s = Math.min(1, Math.max(0, dMin / margin));
    if (s < worst) worst = s;
  }
  return worst;
}

/** Score compuesto: base ponderada × penalización de excentricidad. */
export function computeTotalScore(
  parts: {
    sharpness: number;
    exposure: number;
    stability: number;
    eccentricity?: number | null;
  },
  sharpnessVar: number,
  specularRatio = 0
): QualityScore {
  const entries: Array<[value: number, weight: number]> = [
    [parts.sharpness, WEIGHTS.sharpness],
    [parts.exposure, WEIGHTS.exposure],
    [parts.stability, WEIGHTS.stability],
  ];
  let ecc = 1;
  if (parts.eccentricity !== undefined && parts.eccentricity !== null) {
    ecc = parts.eccentricity;
  }
  const wSum = entries.reduce((acc, [, w]) => acc + w, 0);
  const base = entries.reduce((acc, [v, w]) => acc + v * w, 0) / wSum;
  const total = base * ecc;
  return {
    sharpness: parts.sharpness,
    exposure: parts.exposure,
    stability: parts.stability,
    eccentricity: ecc,
    specular: specularRatio,
    total: Math.min(1, Math.max(0, total)),
    isBlur: sharpnessVar < BLUR_THRESHOLD,
  };
}

/**
 * Disparo k-de-n (F2-c): true si entre las últimas N muestras dentro de
 * SPAN hay al menos K con score > SHUTTER_SCORE Y la última también es
 * buena. Tolera caídas puntuales del autofocus/exposición.
 */
export function shouldTriggerShutter(history: ScoreSample[]): boolean {
  if (history.length < SHUTTER_K) return false;
  const sorted = [...history].sort((a, b) => a.t - b.t);
  const now = sorted[sorted.length - 1]!.t;
  const last = sorted[sorted.length - 1]!;
  if (last.score <= SHUTTER_SCORE) return false;
  const inSpan = sorted.filter((s) => s.t >= now - SHUTTER_SPAN_MS);
  const lastN = inSpan.slice(-SHUTTER_N);
  if (lastN.length < SHUTTER_K) return false;

  // F-STAB: Compuerta de tiempo sostenido para evitar falsos positivos por
  // alta velocidad (la mano aún acomodando el teléfono).
  const firstSampleTime = lastN[0]!.t;
  const windowDurationMs = now - firstSampleTime;
  if (windowDurationMs < SHUTTER_SUSTAIN_MS) {
    return false; // La muestra fue demasiado rápida; el usuario aún está acomodando
  }

  let good = 0;
  for (const s of lastN) if (s.score > SHUTTER_SCORE) good++;
  return good >= SHUTTER_K;
}

/** Escape a manual: true si pasó más de NO_DETECT_TIMEOUT_MS desde el primer intento. */
export function detectionTimedOut(firstAttemptMs: number, nowMs: number): boolean {
  return nowMs - firstAttemptMs > NO_DETECT_TIMEOUT_MS;
}

/** Histograma de 256 bins de luma de un ImageData (para exposición). */
export function lumaHistogram(data: Uint8ClampedArray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const l =
      0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    hist[Math.min(255, Math.max(0, Math.round(l)))]! += 1;
  }
  return hist;
}
