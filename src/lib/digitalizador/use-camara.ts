"use client";

// ============================================================
// DIGITALIZADOR E-14 — Cámara v6.3 (port fiel del mecanismo de
// web-scanner v6.3, probado en producción):
//   · DUAL PIPELINE: la captura MANDA con takePhoto() a resolución
//     del sensor (12–48 MP, independiente del preview de 540p);
//     si cuelga (>8 s), no existe o FileReader falla → burst de
//     respaldo [zsl, snapA, snapB], ganador por nitidez y encode
//     SOLO del ganador (F-RES-PRIORITY: un frame de preview NUNCA
//     sustituye una foto full-sensor).
//   · F-SENSOR-PROFILER: perfil del sensor de FOTO 1 vez por
//     apertura (getPhotoCapabilities) → photoSettings con tope
//     (capa 1, el ISP escala EN la captura) + clampBlobToSafeCap
//     post-decode (capa 2, red de seguridad).
//   · F-STAB: compuerta de quietud inercial (DeviceMotion, 280 ms)
//     ANTES del disparo automático — sin consumir el historial
//     k-de-n (el trigger se re-evalúa en el próximo frame).
//   · F-ZSL: ring Best-Shot (máx 8 frames, ~5 Hz) del <video>; en
//     captura manual el ganador pre-tap (80–450 ms) compensa el
//     tap-shock (el impacto del dedo sacude el teléfono).
//   · F-LENS: sondas SECUENCIALES de cámaras (cerrar SIEMPRE el
//     MediaStream antes de abrir la siguiente).
//   · Preview ligero 960×540 @30: la captura ya no depende del
//     stream; el preview solo alimenta la detección en vivo
//     (detector a ≤400 px) y el ring ZSL — mitad de GPU en gama
//     baja. Si la detección viva empeorara, subir a 1280×720 (ver
//     INSTRUCCIONES-CAMARA-v63.md Fase D).
//   · Linterna verificada (F-FLASH v3). iOS/Safari sin ImageCapture
//     → el shutter abre la cámara NATIVA (input capture).
// WYSIWYG v6.2 reemplazado por decisión de producto — paridad con
// web-scanner v6.3.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { detectarFrameRgba } from "./escaner";
import type { Quad } from "./escaner";
// [CAMARA v6.3] Utilidades del motor (scanner-core es AUTO-GENERADO
// por sync:scanner — se importan, NO se reimplementan):
import { MotionStabilizer } from "@/lib/scanner-core/motion-stabilizer";
import {
  buildCappedPhotoSettings,
  clampBlobToSafeCap,
  getSensorSafeCap,
  profileSensor,
  type SensorProfile,
} from "@/lib/scanner-core/sensor-profiler";

// ------------------------------------------------------------
// Constantes de la especificación
// ------------------------------------------------------------
// F-D (v6.3): preview ligero — upstream usa exactamente 960×540 @30
// (IDEAL_PREVIEW_WIDTH/HEIGHT/FPS de CameraView.tsx). La captura ya
// NO depende del stream (takePhoto dispara al sensor físico).
const IDEAL_PREVIEW_WIDTH = 960;
const IDEAL_PREVIEW_HEIGHT = 540;
const IDEAL_PREVIEW_FPS = 30;

const FRONT_CAMERA_RE = /front|delantera|anterior|face|facial|selfie/i;
const LENS_WORDS_RE = /ultra|gran angular|wide|angular|tele|teleobjetivo/i;
const REAL_AF_MODES = new Set(["continuous", "single-shot"]);

const FRAME_MAX = 400;        // lado mayor del frame para detección
const TELEMETRIA_MS = 100;    // ~10 Hz hacia la UI
const SHUTTER_SCORE = 0.8;    // k-de-n
const SHUTTER_K = 4;
const SHUTTER_N = 6;
const SHUTTER_SPAN_MS = 1200;
const CAPTURE_COOLDOWN_MS = 1500;

export interface EstadoCamara {
  /** null = iniciando | "lista" | "denegada" | "error" | "nodispositivo" */
  estado: "iniciando" | "lista" | "denegada" | "error" | "nodispositivo";
  mensaje: string | null;
  /** Quad detectado en vivo (normalizado) o null */
  quadVivo: Quad | null;
  /** Score compuesto 0-1 (telemetría ~10 Hz) */
  scoreVivo: number | null;
  /** Autocaptura lista para disparar (k-de-n armado y sobre umbral) */
  armada: boolean;
  torchOn: boolean;
  esCamaraReal: boolean;
  /** iOS/Safari sin ImageCapture → el shutter abre la cámara nativa */
  usarCamaraNativa: boolean;
}

export interface OpcionesCamara {
  activa: boolean;
  /** Disparo automático por calidad (k-de-n) */
  autocaptura?: boolean;
  /** Ref del <video> (creado por el componente, patrón canónico) */
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Recibe la foto del sensor (o el mejor frame) ya en data URL */
  alCapturar: (dataUrl: string) => void;
}

interface HistorialMuestra {
  ts: number;
  score: number;
}

/** Frame de video del burst: canvas a resolución del track + nitidez
 *  medida a ≤400 px (la MISMA escala del ring ZSL y del frame loop →
 *  ranking consistente, §5.4). */
interface FrameCapturado {
  canvas: HTMLCanvasElement;
  nitidez: number;
}

export function useCamara(opts: OpcionesCamara) {
  const { activa, autocaptura = true, alCapturar, videoRef } = opts;

  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const rafRef = useRef<number | null>(null);
  const nonceRef = useRef(0);
  const procesandoRef = useRef(false);
  const cooldownRef = useRef(0);
  const historialRef = useRef<HistorialMuestra[]>([]);
  const quadHistRef = useRef<{ ts: number; quad: Quad }[]>([]);
  const rearmRef = useRef(false);
  const ultimoQuadRef = useRef<Quad | null>(null);
  const workerBusyRef = useRef(false);
  // F-STAB — estabilizador de inercia (DeviceMotion) + compuerta de
  // quietud: bloquea la auto-captura mientras la mano se acomoda o
  // tiembla (4–8 Hz). 1 instancia por apertura (se destruye en detener).
  const stabilizadorRef = useRef<MotionStabilizer | null>(null);
  // F-ZSL — buffer circular Best-Shot: los últimos 8 fotogramas
  // medidos del <video>. En captura MANUAL el ganador (mayor nitidez)
  // entre 80 y 450 ms ANTES del tap sustituye al frame del instante
  // del impacto (el tap-shock sacude mecánicamente el teléfono → foto
  // borrosa; el frame pre-tap ya está estable — patrón Zero Shutter
  // Lag de las cámaras nativas).
  // Nota del port: upstream guarda lapVar bruto; aquí la nitidez
  // NORMALIZADA de metricasDeFrame (monótona con lapVar → ranking
  // equivalente), medida a la misma escala de ≤400 px.
  const bestShotRingRef = useRef<
    Array<{ canvas: HTMLCanvasElement; nitidez: number; timestamp: number }>
  >([]);
  const lastRingFeedRef = useRef(0);
  const ringScratchRef = useRef<HTMLCanvasElement | null>(null);
  /** F-SENSOR-PROFILER: perfil del sensor de FOTO del track vivo
   *  (resolución nativa + tope seguro 4032/3200 px según la gama
   *  medida). null = aún sin sondear. */
  const sensorProfileRef = useRef<SensorProfile | null>(null);
  /** iOS NO se rompe (regla 3): MISMO valor que hayImageCapture de
   *  iniciar() — una sola fuente de verdad para el Dual Pipeline. */
  const canTakePhotoRef = useRef(false);

  const [estadoCamara, setEstadoCamara] = useState<EstadoCamara>({
    estado: "iniciando",
    mensaje: null,
    quadVivo: null,
    scoreVivo: null,
    armada: false,
    torchOn: false,
    esCamaraReal: false,
    usarCamaraNativa: false,
  });
  const estadoRef = useRef(estadoCamara);
  const alCapturarRef = useRef(alCapturar);
  const autocapturaRef = useRef(autocaptura);

  // Sincronizar refs fuera del render (eventos/loops leen siempre el valor vigente)
  useEffect(() => {
    estadoRef.current = estadoCamara;
    alCapturarRef.current = alCapturar;
    autocapturaRef.current = autocaptura;
  }, [estadoCamara, alCapturar, autocaptura]);

  /** Callback ref del <video>: asigna el elemento al ref externo */
  const setVideoElement = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
    },
    [videoRef]
  );

  const setParcial = useCallback((p: Partial<EstadoCamara>) => {
    setEstadoCamara((s) => ({ ...s, ...p }));
  }, []);

  const detener = useCallback(() => {
    nonceRef.current++;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    workerBusyRef.current = false;
    historialRef.current = [];
    quadHistRef.current = [];
    ultimoQuadRef.current = null;
    rearmRef.current = false;
    // F-STAB: fuera la escucha de DeviceMotion (iniciar() re-crea el
    // estabilizador en la próxima apertura).
    stabilizadorRef.current?.destroy();
    stabilizadorRef.current = null;
    // F-ZSL: libera el buffer Best-Shot + scratch al cerrar la sesión
    // (disciplina de RAM iOS, error #22 upstream — no esperar al GC).
    for (const f of bestShotRingRef.current) {
      f.canvas.width = 0;
      f.canvas.height = 0;
    }
    bestShotRingRef.current = [];
    lastRingFeedRef.current = 0;
    if (ringScratchRef.current) {
      ringScratchRef.current.width = 0;
      ringScratchRef.current.height = 0;
      ringScratchRef.current = null;
    }
  }, []);

  // ----------------------------------------------------------
  // Apertura de cámara (mecanismo v2)
  // ----------------------------------------------------------

  /**
   * getUserMedia con límite de tiempo (un prompt colgado no debe
   * congelar la app).
   * [OLA7 · A-3 AN-3] Cuando el timeout gana la carrera, el gUM
   * subyacente NO se cancela (no hay API): si el permiso llega tarde
   * y resuelve después, el stream quedaría vivo sin dueño (LED de
   * cámara encendido + batería). Se vigila al perdedor: un stream
   * tardío se cierra al instante, y el timer se limpia si gUM llega
   * primero (sin temporizadores colgando en las cascadas de sondas).
   */
  const gumConLimite = useCallback(async (constraints: MediaStreamConstraints, ms: number): Promise<MediaStream> => {
    let expirado = false;
    let temporizador: ReturnType<typeof setTimeout> | null = null;
    const timerProm = new Promise<never>((_, rej) => {
      temporizador = setTimeout(() => {
        expirado = true;
        rej(new DOMException("getUserMedia timeout", "TimeoutError"));
      }, ms);
    });
    const gumProm = navigator.mediaDevices.getUserMedia(constraints);
    // Perdedor tardío: stream que llega DESPUÉS del timeout → cerrarlo
    // YA (nadie lo va a detener); rechazo tardío → ignorar (ya perdió).
    void gumProm.then(
      (stream) => {
        if (expirado) stream.getTracks().forEach((t) => t.stop());
      },
      () => undefined
    );
    try {
      return await Promise.race([gumProm, timerProm]);
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }
  }, []);

  /** F-LENS v4: desbloquear labels, sondear SECUENCIAL, elegir trasera ganadora */
  const abrirCamaraPrincipal = useCallback(async (): Promise<{ stream: MediaStream; track: MediaStreamTrack } | null> => {
    if (!navigator.mediaDevices?.enumerateDevices) return null;
    try {
      // Desbloqueo de labels: abrir y cerrar inmediatamente
      const desbloqueo = await gumConLimite({ video: true }, 6000);
      desbloqueo.getTracks().forEach((t) => t.stop());
    } catch {
      return null; // sin permiso: deja que la cascada lo gestione
    }

    let devices: MediaDeviceInfo[];
    try {
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return null;
    }
    const videoinputs = devices.filter((d) => d.kind === "videoinput");
    if (videoinputs.length === 0) return null;

    interface Sonda {
      deviceId: string;
      label: string;
      af: boolean;
      torch: boolean;
      ancho: number;
      alto: number;
    }
    const sondas: Sonda[] = [];

    // Sondas SECUENCIALES: cerrar SIEMPRE el stream antes de la siguiente
    for (const d of videoinputs) {
      let stream: MediaStream | null = null;
      try {
        stream = await gumConLimite(
          { video: { deviceId: { exact: d.deviceId } }, audio: false },
          6000
        );
        const track = stream.getVideoTracks()[0];
        if (!track) continue;
        const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
          torch?: boolean;
          focusMode?: string[];
        };
        const settings = track.getSettings?.() ?? {};
        sondas.push({
          deviceId: d.deviceId,
          label: d.label ?? "",
          af: (caps.focusMode ?? []).some((m) => REAL_AF_MODES.has(m)),
          torch: Boolean(caps.torch),
          ancho: caps.width?.max ?? settings.width ?? 1280,
          alto: caps.height?.max ?? settings.height ?? 720,
        });
      } catch {
        // dispositivo no abrible: se ignora
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
        stream = null;
      }
    }

    // chooseMainProbe: traseras que no matcheen frontal
    const traseras = sondas.filter((s) => !FRONT_CAMERA_RE.test(s.label));
    const candidatas = traseras.length > 0 ? traseras : sondas;
    if (candidatas.length === 0) return null;

    let ganadora: Sonda;
    if (candidatas.some((s) => s.af)) {
      // con AF real: la de mayor resolución de sensor (torch desempata)
      ganadora = candidatas
        .filter((s) => s.af)
        .sort((a, b) => b.ancho * b.alto - a.ancho * a.alto || Number(b.torch) - Number(a.torch))[0];
    } else {
      // típico iOS: filtrar lentes por label, menos palabras = principal
      const simples = candidatas.filter((s) => !LENS_WORDS_RE.test(s.label));
      const pool = simples.length > 0 ? simples : candidatas;
      ganadora = pool.sort(
        (a, b) =>
          (a.label.match(/\s/g)?.length ?? 0) - (b.label.match(/\s/g)?.length ?? 0) ||
          b.ancho * b.alto - a.ancho * a.alto
      )[0];
    }

    // Abrir SOLO la ganadora con cascada. F-D (v6.3): preview ligero
    // 960×540 @30 — la captura ya no depende del stream (takePhoto al
    // sensor); el preview solo alimenta la detección viva (≤400 px) y
    // el ring ZSL. El reintento SIN dimensiones queda como estaba.
    const intentos: MediaStreamConstraints[] = [
      {
        video: {
          deviceId: { exact: ganadora.deviceId },
          width: { ideal: IDEAL_PREVIEW_WIDTH },
          height: { ideal: IDEAL_PREVIEW_HEIGHT },
          frameRate: { ideal: IDEAL_PREVIEW_FPS },
        },
        audio: false,
      },
      { video: { deviceId: { exact: ganadora.deviceId } }, audio: false },
    ];
    for (const c of intentos) {
      try {
        const stream = await gumConLimite(c, 5000);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("sin track");
        return { stream, track };
      } catch {
        // siguiente intento
      }
    }
    return null;
  }, [gumConLimite]);

  /** Cascada de emergencia (E3/E4): facingMode environment → video genérico.
   *  F-D: las dos primeras con preview ligero 960×540 @30. */
  const abrirConCascada = useCallback(async (): Promise<{ stream: MediaStream; track: MediaStreamTrack }> => {
    const cascadas: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { exact: "environment" },
          width: { ideal: IDEAL_PREVIEW_WIDTH },
          height: { ideal: IDEAL_PREVIEW_HEIGHT },
          frameRate: { ideal: IDEAL_PREVIEW_FPS },
        },
        audio: false,
      },
      {
        video: {
          facingMode: "environment",
          width: { ideal: IDEAL_PREVIEW_WIDTH },
          height: { ideal: IDEAL_PREVIEW_HEIGHT },
          frameRate: { ideal: IDEAL_PREVIEW_FPS },
        },
        audio: false,
      },
      { video: { facingMode: "environment" }, audio: false },
      { video: true, audio: false },
    ];
    const inicio = Date.now();
    let ultimoError: unknown = null;
    for (const c of cascadas) {
      if (Date.now() - inicio > 14000) break; // no eternizarse
      try {
        const stream = await gumConLimite(c, 5000);
        const track = stream.getVideoTracks()[0];
        if (!track) throw new Error("sin track de video");
        return { stream, track };
      } catch (e) {
        ultimoError = e;
      }
    }
    throw ultimoError ?? new Error("getUserMedia falló");
  }, [gumConLimite]);

  // ----------------------------------------------------------
  // Linterna (F-FLASH v3): aplicar + verificar + deshacer fantasma
  // ----------------------------------------------------------
  const encenderTorch = useCallback(async (on: boolean): Promise<boolean> => {
    const track = trackRef.current;
    if (!track) return false;
    try {
      // advanced = best-effort (no rechaza aunque no soporte)
      await track.applyConstraints({
        advanced: [{ torch: on }],
      } as unknown as MediaTrackConstraints);
      // verificar con getSettings (el "flash fantasma" se descubre aquí)
      const settings = track.getSettings?.() as MediaTrackSettings & { torch?: boolean };
      if (on && settings.torch !== true) {
        // deshacer para no dejar LED fantasma
        await track.applyConstraints({
          advanced: [{ torch: false }],
        } as unknown as MediaTrackConstraints);
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  const alternarTorch = useCallback(async () => {
    if (!trackRef.current || !estadoRef.current.esCamaraReal) return;
    const on = !estadoRef.current.torchOn;
    const ok = await encenderTorch(on);
    if (ok) {
      setParcial({ torchOn: on });
    } else {
      setParcial({ torchOn: false });
      toast({
        title: "No se pudo controlar la linterna aquí",
        description:
          "Causas típicas: navegador sin soporte (en iPhone usa Safari 17.4 o posterior), cámara sin LED (gran angular o macro) o la app corre dentro de otra app. Cierra y vuelve a abrir el escáner.",
        duration: 8000,
      });
    }
  }, [encenderTorch, setParcial]);

  /** Reintentos de torch tras abrir: 0/250/700/1500 ms */
  const reaplicarTorch = useCallback(async () => {
    if (!estadoRef.current.torchOn) return;
    for (const ms of [0, 250, 700, 1500]) {
      await new Promise((r) => setTimeout(r, ms));
      if (await encenderTorch(true)) {
        setParcial({ torchOn: true });
        return;
      }
    }
  }, [encenderTorch, setParcial]);

  // ----------------------------------------------------------
  // Score k-de-n
  // ----------------------------------------------------------
  const registrarMuestra = useCallback((score: number): boolean => {
    const ahora = Date.now();
    const h = historialRef.current;
    h.push({ ts: ahora, score });
    while (h.length > 0 && ahora - h[0].ts > SHUTTER_SPAN_MS) h.shift();
    if (h.length > SHUTTER_N * 2) h.splice(0, h.length - SHUTTER_N * 2);

    if (rearmRef.current) {
      // re-arm: exige score ≤0.8 (no vaciar quadHistory)
      if (score <= SHUTTER_SCORE) rearmRef.current = false;
      else return false;
    }
    const recientes = h.filter((m) => ahora - m.ts <= SHUTTER_SPAN_MS);
    const sobreUmbral = recientes.filter((m) => m.score > SHUTTER_SCORE).length;
    const ultima = recientes[recientes.length - 1];
    return (
      sobreUmbral >= SHUTTER_K &&
      recientes.length >= SHUTTER_K &&
      ultima != null &&
      ultima.score > SHUTTER_SCORE
    );
  }, []);

  const notificarCapturado = useCallback(() => {
    historialRef.current = [];
    rearmRef.current = true;
    cooldownRef.current = Date.now() + CAPTURE_COOLDOWN_MS;
  }, []);

  // ----------------------------------------------------------
  // F-ZSL — ring Best-Shot + burst de respaldo (port v6.3)
  // ----------------------------------------------------------

  /** Copia el fotograma al ring (máx 8) y suelta YA el backing store
   *  del expulsado (no espera al GC; disciplina de memoria iOS,
   *  error #22 upstream). */
  const pushRingFrame = useCallback((canvas: HTMLCanvasElement, nitidez: number) => {
    const ring = bestShotRingRef.current;
    const copia = document.createElement("canvas");
    copia.width = canvas.width;
    copia.height = canvas.height;
    copia.getContext("2d")?.drawImage(canvas, 0, 0);
    ring.push({ canvas: copia, nitidez, timestamp: performance.now() });
    if (ring.length > 8) {
      const expulsada = ring.shift();
      if (expulsada) {
        expulsada.canvas.width = 0;
        expulsada.canvas.height = 0;
      }
    }
  }, []);

  /** Alimenta el ring desde el <video> vivo a ~5 Hz (mín 200 ms entre
   *  feeds): garantiza que el buffer SIEMPRE cubra la ventana pre-tap
   *  de 80–450 ms. Invocado desde el frame loop (frames PROCESADOS —
   *  los descartados por backpressure no alimentan, igual que
   *  upstream). Reutiliza UN scratch canvas a resolución del track:
   *  coste por feed ≈ 1 drawImage + 1 medición a ≤400 px + 1 copia.
   *  (La alternativa de reutilizar el canvas de ≤400 px del loop
   *  ahorraría un drawImage, pero entregaría capturas de respaldo a
   *  400 px — upstream entrega frames del preview 960×540.) */
  const feedRingFromVideo = useCallback((): void => {
    const ahora = performance.now();
    if (ahora - lastRingFeedRef.current < 200) return;
    lastRingFeedRef.current = ahora;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    if (!ringScratchRef.current) ringScratchRef.current = document.createElement("canvas");
    const scratch = ringScratchRef.current;
    if (scratch.width !== video.videoWidth || scratch.height !== video.videoHeight) {
      scratch.width = video.videoWidth;
      scratch.height = video.videoHeight;
    }
    const ctx = scratch.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    pushRingFrame(scratch, medirNitidez(scratch, scratch.width, scratch.height));
  }, [pushRingFrame]);

  /** Instantánea del <video> a resolución del track + nitidez del MISMO
   *  fotograma (medida a ≤400 px, la misma escala del ring → ranking
   *  consistente, §5.4). Sincronónica y SIN encodear JPEG: el encode
   *  solo ocurre si el frame gana el burst. */
  const snapshotVideo = useCallback((): FrameCapturado | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const nitidez = medirNitidez(canvas, canvas.width, canvas.height);
    // F-ZSL: alimenta el buffer Best-Shot con este fotograma medido.
    pushRingFrame(canvas, nitidez);
    return { canvas, nitidez };
  }, [pushRingFrame]);

  // ----------------------------------------------------------
  // DUAL PIPELINE (pilar 2) — Captura a RESOLUCIÓN DEL SENSOR como
  // Blob (aún SIN convertir a data URL): takePhoto() IGNORA la
  // resolución del <video> de 540p y dispara directo al sensor físico
  // (12–48 MP, p.ej. 4000×3000). Carrera de 8 s (takePhoto puede
  // colgarse — error #29 upstream); null → el llamador cae al burst
  // [zsl, snapA, snapB]. La orientación EXIF la aplica el pipeline al
  // decodificar (createImageBitmap(..., { imageOrientation:
  // "from-image" }) en escaner.ts) — la foto llega bien orientada.
  // ----------------------------------------------------------
  const takePhotoBlob = useCallback(async (): Promise<Blob | null> => {
    const track = trackRef.current;
    if (!track || typeof ImageCapture === "undefined") return null;
    try {
      const capture = new ImageCapture(track);
      // El sensor manda, el preview no limita... EXCEPTO cuando el
      // sensor excede el tope seguro (48/108 MP): el F-SENSOR-PROFILER
      // pide al ISP una foto dentro del tope EN la captura (capa 1) y
      // el blob del gigante jamás llega a decodificarse.
      const profile = sensorProfileRef.current;
      const settings = profile ? buildCappedPhotoSettings(profile) : undefined;
      const attempt = async (ps?: PhotoSettings): Promise<Blob | null> => {
        try {
          const blob = await Promise.race([
            capture.takePhoto(ps),
            new Promise<never>((_, reject) =>
              window.setTimeout(() => reject(new Error("takePhoto timeout 8s")), 8000)
            ),
          ]);
          return blob && blob.size > 0 ? blob : null;
        } catch {
          return null;
        }
      };
      let blob = await attempt(settings);
      // Reintento sin photoSettings si el ajuste del profiler fue
      // rechazado (hardware exótico): mejor foto sin tope que perder
      // la captura.
      if (!blob && settings) blob = await attempt(undefined);
      if (!blob) return null;
      // Capa 2 — red de seguridad post-decode (solo recorta si el
      // blob excede el tope; si no, el blob original pasa intacto).
      return await clampBlobToSafeCap(blob, profile?.safeCapPx ?? getSensorSafeCap());
    } catch {
      return null;
    }
  }, []);

  // ----------------------------------------------------------
  // Captura inteligente (port de captureSmart v6.3):
  // la FOTO FULL-SENSOR MANDA (12–48 MP vía takePhoto, independiente
  // del preview de 540p):
  //   1. Frame A: solo píxeles + medidas (respaldo sin coste).
  //   2. Foto hi-res del sensor (takePhoto, carrera de 8 s) → data URL.
  //   3. Si hay foto → dispatch YA (los frames se descartan, R-14).
  // Fallback premium si takePhoto no existe o cuelga: el ganador ZSL
  // pre-tap (80–450 ms antes del disparo, anti tap-shock) del ring
  // Best-Shot compite por nitidez con snapA/snapB — nunca un frame
  // reemplaza una foto existente (F-RES-PRIORITY: una foto algo
  // blanda a 3264 px siempre supera a un frame perfecto de 540p; el
  // enhance afina, retomar cuesta un toque). Cooldown anti
  // doble-disparo 1500 ms (§5.2).
  // ----------------------------------------------------------
  const capturar = useCallback(async (): Promise<void> => {
    const video = videoRef.current;
    if (!video || !trackRef.current) return;
    if (procesandoRef.current) return;
    if (Date.now() < cooldownRef.current) return;
    procesandoRef.current = true;
    notificarCapturado(); // (= notifyCaptured: historial + rearm + cooldown 1500)
    setParcial({ scoreVivo: null, armada: false });

    /** F-ZSL — recupera el ganador pre-tap del buffer Best-Shot (mayor
     *  nitidez entre 80 y 450 ms antes del disparo: el impacto del dedo
     *  sacude mecánicamente el teléfono, el frame PRE-tap ya está
     *  estable) y VACÍA el ring. Frame listo para el burst o null. */
    const takeZslFallback = (): FrameCapturado | null => {
      const ahoraMs = performance.now();
      const ring = bestShotRingRef.current;
      const enVentana = ring.filter((f) => {
        const edad = ahoraMs - f.timestamp;
        return edad >= 80 && edad <= 450;
      });
      const ganador =
        enVentana.length > 0
          ? enVentana.reduce((a, b) => (b.nitidez > a.nitidez ? b : a))
          : null;
      // El disparo se atiende: libera el ring (disciplina RAM) EXCEPTO
      // el canvas del ganador — su propiedad pasa al burst
      // (liberarFrame lo suelta al terminar el dispatch). Ponerlo a 0
      // aquí rompería el encode (canvas 0×0 → toBlob null /
      // toDataURL InvalidStateError).
      for (const f of ring) {
        if (f === ganador) continue;
        f.canvas.width = 0;
        f.canvas.height = 0;
      }
      bestShotRingRef.current = [];
      if (!ganador) return null;
      // El canvas del ring ya es una copia dedicada: entrega directo.
      return { canvas: ganador.canvas, nitidez: ganador.nitidez };
    };

    /** Mejor frame por nitidez → encode SOLO del ganador → dispatch. */
    const despacharMejorFrame = async (frames: Array<FrameCapturado | null>): Promise<void> => {
      const validos = frames.filter((f): f is FrameCapturado => f !== null);
      if (validos.length === 0) {
        toast({ title: "No se pudo capturar", description: "Inténtalo de nuevo.", variant: "destructive" });
        return;
      }
      const ganador = validos.reduce((a, b) => (b.nitidez > a.nitidez ? b : a));
      const url = await lienzoADataUrl(ganador.canvas);
      for (const f of validos) liberarFrame(f);
      if (url) {
        alCapturarRef.current(url);
      } else {
        // encode falló → feedback en vez de descartar el disparo.
        toast({ title: "No se pudo capturar", description: "Inténtalo de nuevo.", variant: "destructive" });
      }
    };

    try {
      // §5.4 — frame A ANTES de la foto: si takePhoto cuelga y cae (8 s),
      // ya queda un candidato válido medido.
      const snapA = snapshotVideo();
      const photoBlob = canTakePhotoRef.current ? await takePhotoBlob() : null;
      if (!photoBlob) {
        // takePhoto colgó (> 8 s) o no existe: avisamos solo con stream
        // real — el fotograma de preview (540p) es un recurso, no el
        // estándar.
        if (estadoRef.current.esCamaraReal) {
          toast({
            title: "Cámara lenta: baja resolución esta vez",
            description: "La foto de alta resolución no respondió; se guardó el fotograma de vista previa.",
            duration: 6000,
          });
        }
        // DUAL PIPELINE — fallback: el ganador ZSL pre-tap (estable,
        // anti tap-shock) compite por nitidez con snapA y el frame
        // actual.
        const zsl = takeZslFallback();
        await despacharMejorFrame([zsl, snapA, snapshotVideo()]);
        return;
      }

      // F-RES-PRIORITY — la foto full-sensor SIEMPRE gana. Blob → data
      // URL (FileReader); los frames de video se descartan (libera
      // backing stores). NUNCA un frame de preview sustituye una foto
      // full-sensor.
      let fotoUrl: string | null = null;
      try {
        fotoUrl = await blobADataUrl(photoBlob);
      } catch {
        fotoUrl = null; // FileReader falló (rarísimo) → burst de frames
      }
      if (fotoUrl) {
        liberarFrame(snapA);
        alCapturarRef.current(fotoUrl);
        return;
      }
      await despacharMejorFrame([snapA, snapshotVideo()]);
    } finally {
      procesandoRef.current = false;
    }
  }, [notificarCapturado, setParcial, snapshotVideo, takePhotoBlob]);

  /** Disparo manual (shutter). Devuelve true si debe abrir cámara nativa. */
  const dispararManual = useCallback((): boolean => {
    if (estadoRef.current.usarCamaraNativa) return true;
    void capturar();
    return false;
  }, [capturar]);

  // ----------------------------------------------------------
  // Frame loop (requestVideoFrameCallback, fallback rAF)
  // ----------------------------------------------------------
  const iniciarFrameLoop = useCallback(
    (nonce: number) => {
      const liberarCanvas = (canvas: HTMLCanvasElement) => {
        canvas.width = 0;
        canvas.height = 0;
      };
      let ultTelemetria = 0;

      const procesarFrame = async (video: HTMLVideoElement) => {
        if (nonce !== nonceRef.current) return;
        if (video.readyState < 2 || workerBusyRef.current || procesandoRef.current) {
          // backpressure por DESCARTE: conservar el último quad (sin parpadeo)
          programarSiguiente(video);
          return;
        }
        workerBusyRef.current = true;
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return;
          const escala = Math.min(1, FRAME_MAX / Math.max(vw, vh));
          const w = Math.max(16, Math.round(vw * escala));
          const h = Math.max(16, Math.round(vh * escala));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(video, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);

          // métricas locales del MISMO frame (baratas)
          const metricas = metricasDeFrame(img.data, w, h);

          // F-ZSL: alimenta el buffer Best-Shot (~5 Hz, autolimitado a
          // 200 ms en feedRingFromVideo) — cubre la ventana pre-tap de
          // 80–450 ms para la captura manual sin tap-shock.
          feedRingFromVideo();

          // detección en el worker (si no hay quad nuevo, se conserva el último)
          const buf = img.data.buffer.slice(0) as ArrayBuffer;
          const detectado = await detectarFrameRgba(buf, w, h);
          if (detectado) {
            ultimoQuadRef.current = detectado;
            quadHistRef.current.push({ ts: Date.now(), quad: detectado });
            if (quadHistRef.current.length > 24) quadHistRef.current.shift();
          }
          const quad = ultimoQuadRef.current;
          liberarCanvas(canvas);

          // estabilidad: varianza media de quads de la ventana 600 ms POR TIMESTAMP
          const ahora = Date.now();
          const recientes = quadHistRef.current.filter((q) => ahora - q.ts <= 600);
          let estabilidad = 0.5;
          if (recientes.length >= 2 && quad) {
            let sumaVar = 0;
            for (let i = 1; i < recientes.length; i++) {
              sumaVar += varianzaQuad(recientes[i - 1].quad, recientes[i].quad);
            }
            estabilidad = 1 - Math.min(1, sumaVar / (recientes.length - 1) / 20);
          }

          // excentricidad: penaliza documento pegado al borde
          const excentricidad = quad ? excentricidadDe(quad) : 0.6;
          const score = Math.max(
            0,
            Math.min(
              1,
              (0.4 * metricas.nitidez + 0.3 * metricas.exposicion + 0.3 * estabilidad) * excentricidad
            )
          );

          // telemetría ~10 Hz
          if (ahora - ultTelemetria >= TELEMETRIA_MS) {
            ultTelemetria = ahora;
            const puedeDisparar =
              autocapturaRef.current && Date.now() >= cooldownRef.current && !rearmRef.current;
            setParcial({
              quadVivo: quad,
              scoreVivo: score,
              armada: puedeDisparar && score > SHUTTER_SCORE,
            });
          }

          // disparo k-de-n
          if (autocapturaRef.current && Date.now() >= cooldownRef.current) {
            if (registrarMuestra(score) && !procesandoRef.current) {
              // F-STAB: verificar quietud del dispositivo ANTES de
              // disparar (espejo exacto de frame-loop.ts:390–399) —
              // bloquea la auto-captura si la mano se acomoda o tiembla
              // (4–8 Hz) SIN consumir el historial: el trigger se
              // re-evalúa en el siguiente frame. En desktop sin
              // DeviceMotion, isDeviceStable devuelve stable tras
              // 280 ms (comportamiento upstream idéntico).
              const motion = stabilizadorRef.current?.isDeviceStable(280);
              if (motion && !motion.stable) return; // re-evalúa en el próximo frame
              void capturar();
            }
          }
        } catch {
          // el frame falla en silencio
        } finally {
          workerBusyRef.current = false;
          programarSiguiente(video);
        }
      };

      const programarSiguiente = (video: HTMLVideoElement) => {
        if (nonce !== nonceRef.current) return;
        const srv = (video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        }).requestVideoFrameCallback;
        if (srv) {
          srv.call(video, () => {
            void procesarFrame(video);
          });
        } else if (rafRef.current == null) {
          const tick = () => {
            if (nonce !== nonceRef.current) return;
            void procesarFrame(video);
            rafRef.current = requestAnimationFrame(tick);
          };
          rafRef.current = requestAnimationFrame(tick);
        }
      };

      const video = videoRef.current;
      if (video) programarSiguiente(video);
    },
    [capturar, registrarMuestra, setParcial, feedRingFromVideo]
  );

  // ----------------------------------------------------------
  // Apertura completa
  // ----------------------------------------------------------
  const iniciar = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setParcial({
        estado: "nodispositivo",
        mensaje:
          "Este navegador no soporta acceso a cámara. Cargue la imagen desde la galería o use un acta real de ejemplo.",
      });
      return;
    }
    // Detener PRIMERO (nonce++ + limpieza) y capturar DESPUÉS el nonce vigente
    detener();
    const nonce = ++nonceRef.current;
    setParcial({ estado: "iniciando", mensaje: null, quadVivo: null, scoreVivo: null, armada: false });

    // iOS/Safari sin ImageCapture → cámara nativa en el shutter.
    // canTakePhotoRef bebe de AQUÍ: una sola fuente de verdad (regla 3).
    const hayImageCapture = typeof ImageCapture !== "undefined";
    canTakePhotoRef.current = hayImageCapture;

    let stream: MediaStream | null = null;
    let track: MediaStreamTrack | null = null;
    try {
      const principal = await abrirCamaraPrincipal();
      if (nonce !== nonceRef.current) {
        // [OLA7 · A-2 AN-3] Otro inicio ganó la carrera: este stream
        // YA está vivo y streamRef apunta al del inicio nuevo (nadie
        // lo detendrá) → cerrarlo aquí o la cámara queda encendida
        // en segundo plano (LED + batería) hasta cerrar la pestaña.
        principal?.stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (principal) {
        stream = principal.stream;
        track = principal.track;
      } else {
        const alternativa = await abrirConCascada();
        if (nonce !== nonceRef.current) {
          alternativa.stream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = alternativa.stream;
        track = alternativa.track;
      }
    } catch (e) {
      const err = e as DOMException;
      const denegada = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
      setParcial({
        estado: denegada ? "denegada" : "error",
        mensaje: denegada
          ? "Permiso de cámara denegado. Cargue la imagen desde la galería o use un acta real de ejemplo."
          : "No se pudo iniciar la cámara. Use la galería o un acta real de ejemplo.",
      });
      return;
    }

    streamRef.current = stream;
    trackRef.current = track;

    // F-STAB: estabilizador de inercia 1 vez por apertura (detener lo
    // destruye) — la escucha de DeviceMotion vive lo que vive la cámara.
    if (!stabilizadorRef.current) stabilizadorRef.current = new MotionStabilizer();

    // F-SENSOR-PROFILER: sondea el sensor de FOTO del stream REAL una
    // vez por apertura (fire-and-forget; falla en silencio en Safari →
    // takePhoto dispara a secas y el clamp post-decode protege la RAM).
    const trackActivo = trackRef.current;
    if (trackActivo) {
      void profileSensor(trackActivo).then((p) => {
        sensorProfileRef.current = p;
      });
    }

    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      await video.play().catch(() => undefined);
    }

    // Zoom a 1× (equivale al 0.5× del mismo track; errores ignorados)
    try {
      const caps = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { zoom?: { min?: number } })
        | undefined;
      if (caps?.zoom && (caps.zoom.min ?? 1) < 1) {
        await track?.applyConstraints({
          advanced: [{ zoom: 1 }],
        } as unknown as MediaTrackConstraints);
      }
    } catch {
      // zoom no soportado
    }

    // track.onended → reconexión completa (B3)
    track?.addEventListener("ended", () => {
      if (nonce !== nonceRef.current) return;
      toast({
        title: "SE PERDIÓ LA CÁMARA",
        description: "Reconectando…",
        variant: "destructive",
      });
      void iniciar();
    });

    setParcial({ estado: "lista", esCamaraReal: true, usarCamaraNativa: !hayImageCapture, mensaje: null });

    if (!hayImageCapture) {
      toast({
        title: "iPhone detectado",
        description: "Para máxima calidad dispara manualmente: el botón abrirá la cámara nativa.",
        duration: 6000,
      });
    }

    void reaplicarTorch();
    iniciarFrameLoop(nonce);
  }, [abrirCamaraPrincipal, abrirConCascada, detener, iniciarFrameLoop, reaplicarTorch, setParcial]);

  // ----------------------------------------------------------
  // Ciclo de vida
  // ----------------------------------------------------------
  useEffect(() => {
    if (activa) void iniciar();
    else detener();
    return () => detener();
  }, [activa, detener, iniciar]);

  return {
    /** Estado puro (sin refs) para renderizar la UI */
    estado: estadoCamara,
    iniciar,
    detener,
    alternarTorch,
    dispararManual,
  };
}

// ------------------------------------------------------------
// Helpers de métricas del frame (baratas, main thread)
// ------------------------------------------------------------

function metricasDeFrame(
  rgba: Uint8ClampedArray,
  w: number,
  h: number
): { nitidez: number; exposicion: number } {
  const n = w * h;
  const gris = new Uint8ClampedArray(n);
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const g = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) | 0;
    gris[i] = g;
    suma += g;
  }

  // Laplaciano (nitidez) — SHARPNESS_NORM = 300 · exposición under/over
  let sl = 0;
  let sl2 = 0;
  let nL = 0;
  let under = 0;
  let over = 0;
  for (let y = 1; y < h - 1; y++) {
    const fila = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = fila + x;
      const lap = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - w] - gris[i + w];
      sl += lap;
      sl2 += lap * lap;
      nL++;
      if (gris[i] < 30) under++;
      if (gris[i] > 225) over++;
    }
  }
  const varLap = nL > 0 ? sl2 / nL - (sl / nL) * (sl / nL) : 0;
  const nitidez = Math.max(0, Math.min(1, varLap / 300));
  const exposicion = 1 - Math.min(1, (under + over) / n);
  return { nitidez, exposicion };
}

/** Mide la nitidez normalizada (lapVar/300 — la MISMA matemática de
 *  metricasDeFrame) de una fuente a ≤400 px de lado mayor, sin encode
 *  ni decode (§5.4). Mismo canvas de medición que usa el frame loop →
 *  ranking consistente entre el ring ZSL y los snapshots del burst.
 *  (Equivalente del measurePixels de upstream: ahí lapVar bruto, aquí
 *  la nitidez normalizada — monótona con lapVar.) */
function medirNitidez(src: CanvasImageSource, sw: number, sh: number): number {
  if (!(sw > 0) || !(sh > 0)) return 0;
  const escala = Math.min(1, FRAME_MAX / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * escala));
  const h = Math.max(1, Math.round(sh * escala));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;
  ctx.drawImage(src, 0, 0, w, h);
  const m = metricasDeFrame(ctx.getImageData(0, 0, w, h).data, w, h);
  // R-14: el canvas de medición es efímero.
  canvas.width = 0;
  canvas.height = 0;
  return m.nitidez;
}

function varianzaQuad(a: Quad, b: Quad): number {
  let suma = 0;
  for (let i = 0; i < 4; i++) {
    const dx = a[i].x - b[i].x;
    const dy = a[i].y - b[i].y;
    suma += dx * dx + dy * dy;
  }
  return suma / 4;
}

/** MIN de las 4 esquinas de dMin/(0.05·ladoCorto) — distancia al borde */
function excentricidadDe(quad: Quad): number {
  const lados = [
    Math.hypot(quad[1].x - quad[0].x, quad[1].y - quad[0].y),
    Math.hypot(quad[2].x - quad[1].x, quad[2].y - quad[1].y),
    Math.hypot(quad[3].x - quad[2].x, quad[3].y - quad[2].y),
    Math.hypot(quad[0].x - quad[3].x, quad[0].y - quad[3].y),
  ];
  const ladoCorto = Math.min(...lados);
  let minD = 1;
  for (const p of quad) {
    const d = Math.min(p.x, 1 - p.x, p.y, 1 - p.y);
    if (d < minD) minD = d;
  }
  const base = Math.max(0.0001, 0.05 * ladoCorto);
  return Math.max(0.25, Math.min(1, minD / base));
}

/** R-14 — suelta YA el backing store del canvas perdedor (no espera al
 *  GC; disciplina de memoria iOS, error #22). */
function liberarFrame(f: FrameCapturado | null): void {
  if (f) {
    f.canvas.width = 0;
    f.canvas.height = 0;
  }
}

/** Blob → data URL (para el takePhoto hi-res del Dual Pipeline). */
function blobADataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(new Error("FileReader falló"));
    fr.readAsDataURL(blob);
  });
}

/** Canvas → data URL JPEG 0.92 (toBlob — NUNCA toDataURL en canvas
 *  grande, error #22 — con toDataURL de respaldo si toBlob/FileReader
 *  fallan). Se llama PEREZOSAMENTE: solo sobre el frame que GANA el
 *  burst §5.4. */
async function lienzoADataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", 0.92)
  );
  if (blob && blob.size > 0) {
    try {
      return await blobADataUrl(blob);
    } catch {
      /* cae al toDataURL de abajo */
    }
  }
  try {
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return null;
  }
}
