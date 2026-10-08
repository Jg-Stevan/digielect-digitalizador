/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * F-DEVBENCH — Medición de la CAPACIDAD del dispositivo.
 *
 * Responde a la pregunta del usuario: «¿el dispositivo que se está usando
 * aguanta el procedimiento?». El benchmark mide lo que de verdad cuesta el
 * pipeline (CPU/WASM de warp+enhance y canvas del encode) y deriva un TOPE
 * de resolución dinámico:
 *
 *   high   → 4032 px (foto completa del sensor)
 *   medium → 3200 px
 *   low    → 3200 px (F-RES-PRIORITY v6.1: antes 2560 — la legibilidad del
 *            texto es intocable; con el OCR manual la presión de memoria baja)
 *
 * El resultado se cachea 7 días en localStorage (localStorage disponible
 * siempre que exista window; en SSR/privado falla en silencio) y se puede
 * re-medir desde Ajustes › Rendimiento del dispositivo.
 */

export type DeviceTier = "high" | "medium" | "low";

export interface DeviceCapability {
  tier: DeviceTier;
  /** 0–100 (más = más capaz). */
  score: number;
  /** ms del test de CPU (3.1M ops mixtas) — menos = más rápido. */
  cpuMs: number;
  /** ms del test de canvas (raster 1024² + encode JPEG). */
  canvasMs: number;
  /** hardwareConcurrency (0 = no disponible). */
  cores: number;
  /** navigator.deviceMemory en GB (null si el navegador no lo expone — iOS). */
  deviceMemoryGB: number | null;
  /** Tope del lado mayor para el procesado en este dispositivo. */
  maxProcessedLongSide: number;
  /** Etiqueta amable para la UI. */
  label: string;
  /** Recomendación para la UI. */
  hint: string;
  testedAt: number;
}

const STORAGE_KEY = "escaner-device-cap-v1";
const CACHE_MS = 7 * 86400000;

/** Default del producto sin medir (dispositivo capaz por omisión). */
export const DEFAULT_MAX_PROCESSED_LONG_SIDE = 4032;

const TIER_META: Record<DeviceTier, { label: string; hint: string; cap: number }> = {
  high: {
    label: "Alta",
    hint: "Tu dispositivo procesa a resolución completa (4032 px).",
    cap: 4032,
  },
  medium: {
    label: "Media",
    hint: "Tu dispositivo procesa bien a 3200 px — calidad impecable y más fluida.",
    cap: 3200,
  },
  low: {
    label: "Baja",
    hint: "Dispositivo ajustado: 3200 px, más lento pero el texto siempre es legible.",
    cap: 3200,
  },
};

function readCache(): DeviceCapability | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceCapability;
    if (
      !parsed ||
      typeof parsed.cpuMs !== "number" ||
      typeof parsed.testedAt !== "number" ||
      Date.now() - parsed.testedAt > CACHE_MS
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cap: DeviceCapability): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cap));
  } catch {
    /* privada/lleno: queda solo en memoria esta sesión */
  }
}

/** Test de CPU puro (determinista, ~3.1M ops con sqrt/sin como el enhance). */
function cpuBenchmark(): number {
  const N = 256 * 256;
  const a = new Float32Array(N);
  for (let i = 0; i < N; i++) a[i] = (i % 251) / 251;
  let acc = 0;
  const t0 = performance.now();
  for (let r = 0; r < 12; r++) {
    for (let i = 0; i < N; i++) {
      const v = a[i];
      acc += Math.sqrt(v * 3.7 + 0.13) * Math.sin(v * 6.2831853);
    }
  }
  const dt = performance.now() - t0;
  //anti-DCE: el JIT no puede eliminar el loop si acc se "usa".
  return dt + (acc === 12345.6789 ? 1 : 0);
}

/** Test de canvas: raster 1024² con gradientes + encode JPEG (proxy del
 *  downscale/warp canvas y del toBlob del pipeline). */
async function canvasBenchmark(): Promise<number> {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 9999;
  const t0 = performance.now();
  for (let k = 0; k < 4; k++) {
    const g = ctx.createLinearGradient(0, 0, 1024, 1024);
    g.addColorStop(0, k % 2 ? "#3366aa" : "#aa6633");
    g.addColorStop(1, k % 2 ? "#224488" : "#884422");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 1024);
  }
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9)
  );
  const dt = performance.now() - t0;
  return blob && blob.size > 0 ? dt : dt + 500;
}

/** Puntuación 0-100 con pesos: CPU 55% · núcleos 20% · memoria 25%. */
function computeScore(cpuMs: number, cores: number, memGB: number | null): number {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  // 20 ms → 1.0 · 500 ms → 0.0 (escala logarítmica).
  const cpuScore =
    1 - clamp01((Math.log(Math.max(8, cpuMs)) - Math.log(20)) / (Math.log(500) - Math.log(20)));
  const coreScore = cores > 0 ? clamp01(cores / 8) : 0.5;
  const memScore = memGB ? clamp01((memGB - 1.5) / 6.5) : 0.6;
  return Math.round(100 * (0.55 * cpuScore + 0.2 * coreScore + 0.25 * memScore));
}

/** Mide SIEMPRE (costa ~0,1–1,5 s según dispositivo). No bloquea la UI
 *  crítica: llamarlo tras hidratar o a petición desde Ajustes. */
export async function measureDeviceCapability(): Promise<DeviceCapability> {
  const cpuMs = cpuBenchmark();
  const canvasMs = await canvasBenchmark();
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 0;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const deviceMemoryGB = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  const score = computeScore(cpuMs, cores, deviceMemoryGB);
  const tier: DeviceTier = score >= 66 ? "high" : score >= 33 ? "medium" : "low";
  const meta = TIER_META[tier];
  const cap: DeviceCapability = {
    tier,
    score,
    cpuMs: Math.round(cpuMs * 10) / 10,
    canvasMs: Math.round(canvasMs * 10) / 10,
    cores,
    deviceMemoryGB,
    maxProcessedLongSide: meta.cap,
    label: meta.label,
    hint: meta.hint,
    testedAt: Date.now(),
  };
  writeCache(cap);
  return cap;
}

/** Cache válida (≤7 días) o null. */
export function getCachedDeviceCapability(): DeviceCapability | null {
  if (typeof window === "undefined") return null;
  return readCache();
}

/** Devuelve la medición cacheada o la corre en idle (una vez por sesión).
 *  null mientras no haya dato — los consumidores usan el default 4032. */
export function ensureDeviceCapability(): Promise<DeviceCapability | null> {
  const cached = getCachedDeviceCapability();
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    const run = () => {
      void measureDeviceCapability()
        .then(resolve)
        .catch(() => resolve(null));
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (typeof ric === "function") ric(run);
    else window.setTimeout(run, 1200);
  });
}

/** Tope del lado mayor para processImage según la capacidad medida.
 *  Sin medición (o SSR) → 4032 (default del producto). */
export function getMaxProcessedLongSide(): number {
  return getCachedDeviceCapability()?.maxProcessedLongSide ?? DEFAULT_MAX_PROCESSED_LONG_SIDE;
}

/** Marca de Sonda de QA (patrón __scannerStore/__cameraChoice). */
if (typeof window !== "undefined") {
  (window as unknown as { __deviceCapability?: () => unknown }).__deviceCapability =
    () => getCachedDeviceCapability();
}
