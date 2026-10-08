/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * F-SENSOR-PROFILER (PASO 2 del plan «Para analizar.md») — Detecta la
 * resolución NATIVA del sensor de FOTO (ImageCapture.getPhotoCapabilities)
 * y deriva un TOPE SEGURO de memoria según la gama del dispositivo:
 *
 *   · Sensor ≤ tope  → resolución nativa DIRECTA, sin re-escalar (la foto
 *     del sensor manda, F-RES-PRIORITY intacto).
 *   · Sensor 48/108 MP (> tope) → se limita al tope seguro para evitar que
 *     el canvas consuma cientos de MB y crashee la pestaña:
 *       - gama alta  → 4032 px (4032×3024 ≈ 12.2 MP, igual que el pipeline)
 *       - media/baja → 3200 px
 *
 * DOS CAPAS DE DEFENSA en la captura:
 *  1. photoSettings (imageWidth/imageHeight) en takePhoto() → el ISP del
 *     sensor escala EN la captura: el blob nace pequeño y el gigante
 *     (p.ej. 12000×9000 de un 108 MP) JAMÁS llega a decodificarse.
 *  2. clampBlobToSafeCap() — red de seguridad post-decode para los casos
 *     en que la capa 1 no aplica (Safari sin getPhotoCapabilities) o el
 *     hardware devolvió el modo soportado más cercano por ENCIMA del tope.
 *
 * El tope se toma del benchmark REAL de device-capability (cacheado 7 días
 * en localStorage; default 4032 si aún no hay medición). Los frames del
 * preview (960×540) y del ring ZSL siempre quedan MUY por debajo del tope:
 * este módulo solo protege la foto full-sensor del Dual Pipeline.
 */

import {
  getCachedDeviceCapability,
  type DeviceTier,
} from "./device-capability";

/** Rango de un ajuste de foto según la spec ImageCapture (MediaSettingsRange). */
export interface SensorSettingRange {
  min: number;
  max: number;
  step: number;
}

/** Perfil del sensor de foto activo (se cachea por sesión en CameraView). */
export interface SensorProfile {
  /** Tope seguro del lado mayor para la FOTO en este dispositivo. */
  safeCapPx: number;
  /** Resolución nativa de foto del sensor (null = no medible, p.ej. Safari). */
  nativeW: number | null;
  nativeH: number | null;
  nativeLongSide: number | null;
  /** Rangos declarados por getPhotoCapabilities (null si no existen). */
  wRange: SensorSettingRange | null;
  hRange: SensorSettingRange | null;
  /** ¿El hardware acepta imageWidth/imageHeight en takePhoto()? */
  photoSettingsAdjustable: boolean;
  /** true = el sensor excede el tope → la captura debe recortarse. */
  overCap: boolean;
  /** Gama del dispositivo según el benchmark cacheado (null = sin medir). */
  tier: DeviceTier | null;
  profiledAt: number;
}

/** Último perfil sondeado (para la Sonda de QA del final del módulo). */
let lastProfile: SensorProfile | null = null;

/** Tope seguro actual según el benchmark cacheado — 4032 si aún no hay
 *  medición (espejo de TIER_META en device-capability.ts). */
export function getSensorSafeCap(): number {
  return getCachedDeviceCapability()?.maxProcessedLongSide ?? 4032;
}

/** Lee y valida un MediaSettingsRange que llega «suelto» del DOM. */
function readRange(range: unknown): SensorSettingRange | null {
  if (!range || typeof range !== "object") return null;
  const r = range as { min?: unknown; max?: unknown; step?: unknown };
  if (typeof r.min !== "number" || typeof r.max !== "number") return null;
  if (!(r.max > 0)) return null;
  return {
    min: r.min,
    max: r.max,
    step: typeof r.step === "number" && r.step >= 1 ? r.step : 1,
  };
}

/**
 * Sondea el sensor del track ACTIVO (cámara real). NUNCA rechaza: ante
 * cualquier fallo devuelve el perfil base (tope por gama, nativo
 * desconocido) — la app no se rompe.
 */
export async function profileSensor(track: MediaStreamTrack): Promise<SensorProfile> {
  const cached = getCachedDeviceCapability();
  const safeCapPx = cached?.maxProcessedLongSide ?? 4032;
  const profile: SensorProfile = {
    safeCapPx,
    nativeW: null,
    nativeH: null,
    nativeLongSide: null,
    wRange: null,
    hRange: null,
    photoSettingsAdjustable: false,
    overCap: false,
    tier: cached?.tier ?? null,
    profiledAt: Date.now(),
  };
  lastProfile = profile;
  if (typeof ImageCapture === "undefined") return profile; // Safari/iOS
  try {
    const capture = new ImageCapture(track);
    // Carrera corta: si getPhotoCapabilities se cuelga (hardware raro),
    // mejor un perfil base que bloquear la apertura de la cámara.
    const caps = await Promise.race([
      capture.getPhotoCapabilities(),
      new Promise<never>((_, reject) =>
        window.setTimeout(() => reject(new Error("getPhotoCapabilities timeout")), 2000)
      ),
    ]);
    const w = readRange(caps?.imageWidth);
    const h = readRange(caps?.imageHeight);
    if (!w || !h) return profile;
    profile.wRange = w;
    profile.hRange = h;
    profile.nativeW = w.max;
    profile.nativeH = h.max;
    profile.nativeLongSide = Math.max(w.max, h.max);
    profile.photoSettingsAdjustable = w.max > w.min || h.max > h.min;
    profile.overCap = profile.nativeLongSide > safeCapPx;
  } catch {
    /* Safari y otros: sin getPhotoCapabilities → perfil base.
     * La protección RAM queda en manos de clampBlobToSafeCap(). */
  }
  return profile;
}

/** PASO 2 (capa 1) — photoSettings para takePhoto() que piden al ISP una
 *  foto DENTRO del tope seguro, conservando el aspecto nativo. Devuelve
 *  undefined si no aplica: el llamador dispara takePhoto() a secas
 *  (comportamiento dual-pipeline original, sensor manda). */
export function buildCappedPhotoSettings(
  profile: SensorProfile
): PhotoSettings | undefined {
  if (!profile.overCap || !profile.photoSettingsAdjustable) return undefined;
  if (!profile.nativeW || !profile.nativeH) return undefined;

  /** Elige el valor del rango más cercano al objetivo SIN pasarse de él
   *  (respetando min/max/step de la spec). undefined = mejor no tocar. */
  const pick = (
    range: SensorSettingRange | null,
    native: number,
    target: number
  ): number | undefined => {
    if (!range || native <= 0) return undefined;
    const { min, max, step } = range;
    if (max <= min) return undefined;
    let v = Math.min(target, max);
    v = Math.max(v, min);
    if (step > 1) v = Math.round(v / step) * step;
    v = Math.min(v, max);
    if (v >= native) return undefined; // no recorta nada → no tocar
    return v;
  };

  const w = pick(profile.wRange, profile.nativeW, profile.safeCapPx);
  const hTarget = Math.round((profile.safeCapPx * profile.nativeH) / profile.nativeW);
  const h = pick(profile.hRange, profile.nativeH, hTarget);
  const settings: PhotoSettings = {};
  if (w) settings.imageWidth = w;
  if (h) settings.imageHeight = h;
  if (!settings.imageWidth && !settings.imageHeight) return undefined;
  return settings;
}

/** PASO 2 (capa 2) — Red de seguridad POST-decode: si el blob del sensor
 *  excede el tope (photoSettings no soportado o el ISP devolvió el modo
 *  más cercano por encima), re-escala UNA vez a JPEG 0.92. Es una segunda
 *  compresión, pero SOLO en sensores que exceden el tope — el precio de
 *  no crashear la pestaña; a 0.92 el OCR no percibe diferencia. Nunca
 *  rechaza: si el decode del gigante falla (OOM) devuelve el blob original
 *  y el pipeline del editor aplica su propio tope (maxProcessedLongSide). */
export async function clampBlobToSafeCap(blob: Blob, capPx: number): Promise<Blob> {
  if (!capPx || capPx <= 0) return blob;
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      const long = Math.max(bitmap.width, bitmap.height);
      if (long <= capPx) return blob; // dentro del tope: blob intacto
      const scale = capPx / long;
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return blob;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
      );
      if (!out || out.size === 0) return blob;
      return out;
    } finally {
      // Disciplina de RAM: el bitmap del gigante se suelta YA.
      bitmap.close();
    }
  } catch {
    return blob;
  }
}

/* ── Sonda de QA (patrón __scannerStore/__deviceCapability) ───────────── */
if (typeof window !== "undefined") {
  (window as unknown as { __sensorProfile?: () => unknown }).__sensorProfile =
    () => lastProfile;
  // Herramientas para QA manual (consola/agent-browser): permiten validar
  // el profiler y sus 2 capas con tracks sintéticos (canvas.captureStream)
  // — el sandbox no tiene cámara física.
  (window as unknown as { __sensorTools?: object }).__sensorTools = {
    profileSensor,
    buildCappedPhotoSettings,
    clampBlobToSafeCap,
    getSensorSafeCap,
  };
}
