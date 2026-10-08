/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
"use client";

/**
 * Bucle de frames de cámara → DetectionWorker — port del patrón
 * `src/scanner/camera/frameLoop.ts` + `scan/ScanOrchestrator.ts` (disparo)
 * del usuario (logica-deteccion.zip), adaptado a esta app:
 *
 *  · requestVideoFrameCallback (fallback rAF): solo se procesa cuando HAY
 *    frame nuevo del sensor.
 *  · createImageBitmap(video, {resize 400 preserve, quality low}) → bitmap
 *    TRANSFERIBLE (el worker lo cierra tras leerlo).
 *  · Backpressure por DESCARTE, nunca por cola: si el worker está ocupado
 *    el frame se salta y se cuenta como dropped (flag local).
 *  · Score compuesto por frame (quality.ts) + disparo k-de-n (K=4 de N=6
 *    en 1200 ms con última buena) → auto-captura.
 *  · Sin detección > 8 s → escape a captura manual (aviso al usuario).
 *
 * La exposición se mide de una miniatura de 96 px del MISMO frame (el
 * histograma no viaja en el protocolo del worker — desviación documentada
 * en quality.ts).
 */

import type { Quad } from "./types";
import { MotionStabilizer } from "./motion-stabilizer";
import {
  computeProcessDims,
  getScannerWorker,
  type ScannerWorkerClient,
} from "./detector-client";
import { generateDemoPage } from "./image-processor";
import {
  computeEccentricityScore,
  computeExposureScore,
  computeSharpnessScore,
  computeStabilityScore,
  computeTotalScore,
  detectionTimedOut,
  lumaHistogram,
  shouldTriggerShutter,
  CAPTURE_COOLDOWN_MS,
  NO_DETECT_TIMEOUT_MS,
  MAX_NO_DETECT_NOTICES,
  SHUTTER_SCORE,
  type QuadSample,
  type QualityScore,
  type ScoreSample,
} from "./quality";

export interface FrameLoopTelemetry {
  /** Quad en fracciones 0–1 del frame (TL,TR,BR,BL) o null sin detección. */
  corners: Quad | null;
  /** Score compuesto 0–1 (null si aún no hay muestra). */
  score: QualityScore | null;
  /** FPS efectivo de procesado (frames procesados / segundo). */
  fps: number;
  /** Frames descartados por backpressure desde el arranque. */
  dropped: number;
  /** Frames procesados desde el arranque. */
  processed: number;
  /** true si el pipeline de precisión está activo (worker ready). */
  precision: boolean;
}

export interface FrameLoopCallbacks {
  /** Cada frame procesado (máx ~15/s; el estado ya viene throttleado). */
  onFrame: (t: FrameLoopTelemetry) => void;
  /** k-de-n cumplido → auto-captura (el llamador respeta su propio cooldown). */
  onTrigger: () => void;
  /** Sin detección sostenida > 8 s → sugerir captura manual. */
  onNoDetectTimeout: () => void;
}

/** Historial acotado (evita crecimiento ilimitado en sesiones largas). */
const MAX_HISTORY = 24;

export class CameraFrameLoop {
  private video: HTMLVideoElement | null = null;
  private cb: FrameLoopCallbacks | null = null;
  private client: ScannerWorkerClient | null = null;
  private running = false;
  private vfcHandle = 0;
  private rafHandle = 0;

  // F-STAB — estabilizador de inercia (DeviceMotion) + compuerta de quietud:
  // bloquea la auto-captura mientras la mano se acomoda o tiembla (4–8 Hz).
  private stabilizer = new MotionStabilizer();
  // F-PERF — control de cadencia adaptativo: en gama baja el tick puede
  // saturar el hilo principal (getImageData continuo); el throttle dinámico
  // empieza en ~15 FPS y se relaja hasta ~5 FPS (200 ms) bajo presión.
  private lastTickMs = 0;
  private dynamicThrottleMs = 65; // ~15 FPS en gama alta, hasta 200ms (~5 FPS) en gama baja

  private quadHistory: QuadSample[] = [];
  private scoreHistory: ScoreSample[] = [];
  private firstAttemptMs = 0;
  private lastNoDetectNotice = 0;
  // B9: tope de avisos «No detecto el documento» por sesión de loop —
  // antes sonaba cada 8 s INDEFINIDAMENTE porque firstAttemptMs solo se
  // fijaba en start() y nunca se re-armaba tras una detección exitosa.
  private noDetectNotices = 0;
  private lastTriggerMs = 0;

  private processed = 0;
  private dropped = 0;
  private fpsWindow: number[] = [];

  /** Tras una captura, exige re-encuadre (score < umbral o pérdida de
   *  detección) antes de re-armar el trigger: en hardware real el usuario
   *  aparta la página; sin esto, un documento estático captura infinito. */
  private rearmNeeded = false;

  private thumbCanvas: HTMLCanvasElement | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  /** Arranca el bucle sobre un <video> con stream activo. */
  start(video: HTMLVideoElement, callbacks: FrameLoopCallbacks): void {
    if (this.running) this.stop();
    this.video = video;
    this.cb = callbacks;
    this.client = getScannerWorker();
    this.quadHistory = [];
    this.scoreHistory = [];
    this.processed = 0;
    this.dropped = 0;
    this.fpsWindow = [];
    this.firstAttemptMs = performance.now();
    this.lastTriggerMs = 0;
    // Reset de estado transitorio (reuso de instancia sin stop explícito):
    // rearmNeeded heredado bloquearía el disparo automático hasta que el
    // score caiga de nuevo, y lastNoDetectNotice dispararía el aviso al
    // instante.
    this.rearmNeeded = false;
    this.lastNoDetectNotice = 0;
    this.noDetectNotices = 0;
    // F-PERF: estado del throttle adaptativo limpio en cada sesión de cámara.
    this.lastTickMs = 0;
    this.dynamicThrottleMs = 65;
    this.running = true;
    // Precalienta OpenCV si aún no está (la primera detección tarda más).
    void this.client?.waitReady().then((ok) => {
      if (!ok && this.running) {
        // Sin pipeline de precisión: el bucle no tiene sentido — el llamador
        // cae a su simulación de estabilidad.
        this.stop();
      }
    });
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    const v = this.video;
    if (v?.cancelVideoFrameCallback && this.vfcHandle) {
      v.cancelVideoFrameCallback(this.vfcHandle);
      this.vfcHandle = 0;
    }
    if (this.rafHandle) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    // F-STAB: limpia el listener de DeviceMotion al detener el bucle.
    this.stabilizer.destroy();
    this.video = null;
    this.cb = null;
  }

  /** Cooldown externo (tras capturar, evita re-disparo inmediato).
   *  OJO: solo borra scoreHistory (k-de-n); el quadHistory NO se toca — la
   *  estabilidad del documento no cambia por capturar, y vaciarla haría
   *  caer el score (stability→0) liberando el rearm en falso. */
  notifyCaptured(): void {
    this.lastTriggerMs = performance.now();
    this.scoreHistory = [];
    this.rearmNeeded = true;
  }

  private scheduleNext(): void {
    if (!this.running || !this.video) return;
    const v = this.video;
    // rVFC (solo con frame nuevo del sensor); fallback rAF.
    if (typeof v.requestVideoFrameCallback === "function") {
      this.vfcHandle = v.requestVideoFrameCallback(() => this.tick());
    } else {
      this.rafHandle = requestAnimationFrame(() => this.tick());
    }
  }

  private tick(): void {
    if (!this.running || !this.video || !this.cb) return;
    const now = performance.now();

    // F-PERF — Throttling dinámico adaptativo: evita saturar el hilo
    // principal con getImageData() continuo (stuttering en gama baja).
    if (now - this.lastTickMs < this.dynamicThrottleMs) {
      this.scheduleNext();
      return;
    }
    this.lastTickMs = now;

    const video = this.video;
    if (video.readyState < 2 || !video.videoWidth) {
      this.scheduleNext();
      return;
    }
    const client = this.client;
    // Sin worker / no ready / procesando otro mensaje → DESCARTAR el frame
    // (backpressure por descarte — nunca encolar; constante del usuario).
    // NOTA: NO emitimos null aquí — durante la espera el overlay conserva el
    // último quad conocido; si emitiéramos, el marco azul parpadearía a ~5 Hz
    // en hardware real (detección 50–100 ms vs 30 fps de frames).
    if (!client || !client.isReady || client.busy) {
      this.dropped += 1;
      // F-PERF: en gama baja con saturación, aumenta el tiempo de descanso
      // dinámico (hasta 200 ms ≈ 5 FPS) para devolver aire al hilo principal.
      this.dynamicThrottleMs = Math.min(200, this.dynamicThrottleMs + 15);
      this.scheduleNext();
      return;
    }

    // F-PERF: si el cliente procesa rápido, reduce suavemente el throttle
    // (mínimo 65 ms ≈ 15 FPS — suficiente para el disparo k-de-n).
    this.dynamicThrottleMs = Math.max(65, this.dynamicThrottleMs - 3);

    const w = video.videoWidth;
    const h = video.videoHeight;
    const dims = computeProcessDims(w, h);

    createImageBitmap(video, {
      resizeWidth: dims.w,
      resizeHeight: dims.h,
      resizeQuality: "low",
    })
      .then((bitmap) => {
        if (!this.running) {
          bitmap.close();
          return;
        }
        // Exposición: miniatura de 96 px del MISMO frame (main thread).
        const hist = this.frameHistogram(video);
        void client
          .detectRaw(bitmap, dims.w, dims.h)
          .then((out) => {
            if (!this.running) return;
            this.processed += 1;
            this.fpsWindow.push(now);
            this.fpsWindow = this.fpsWindow.filter((t) => now - t <= 1000);
            this.handleResult(out, hist, dims.w, dims.h, now);
          })
          .catch(() => {
            /* frame perdido: siguiente tick */
          });
      })
      .catch(() => {
        // Frame sin bitmap (presión de memoria / video en estado raro):
        // el scheduleNext() del final de tick() YA programó el siguiente tick
        // — no re-programar aquí o el bucle se duplicaría exponencialmente.
      });

    this.scheduleNext();
  }

  /** Histograma de luma de una miniatura de 96 px (exposición). */
  private frameHistogram(video: HTMLVideoElement): number[] {
    try {
      const TW = 96;
      const TH = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * TW));
      if (
        !this.thumbCanvas ||
        this.thumbCanvas.width !== TW ||
        this.thumbCanvas.height !== TH
      ) {
        this.thumbCanvas = document.createElement("canvas");
        this.thumbCanvas.width = TW;
        this.thumbCanvas.height = TH;
      }
      const ctx = this.thumbCanvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return [];
      ctx.drawImage(video, 0, 0, TW, TH);
      const data = ctx.getImageData(0, 0, TW, TH).data;
      return lumaHistogram(data);
    } catch {
      return [];
    }
  }

  private handleResult(
    out: { corners: Float32Array | null; quality: { laplacianVar: number | null } } | null,
    hist: number[],
    procW: number,
    procH: number,
    now: number
  ): void {
    const cb = this.cb;
    if (!cb) return;

    let corners: Quad | null = null;
    if (out?.corners && out.corners.length === 8) {
      const f = out.corners;
      let ok = true;
      for (let i = 0; i < 8; i++) {
        if (!Number.isFinite(f[i]!) || f[i]! < -0.05 || f[i]! > 1.05) ok = false;
      }
      if (ok) {
        corners = [
          { x: Math.min(1, Math.max(0, f[0]!)), y: Math.min(1, Math.max(0, f[1]!)) },
          { x: Math.min(1, Math.max(0, f[2]!)), y: Math.min(1, Math.max(0, f[3]!)) },
          { x: Math.min(1, Math.max(0, f[4]!)), y: Math.min(1, Math.max(0, f[5]!)) },
          { x: Math.min(1, Math.max(0, f[6]!)), y: Math.min(1, Math.max(0, f[7]!)) },
        ];
      }
    }

    if (!corners) {
      // Sin quad: estabilidad se degrada (historial envejece) y score baja.
      // La pérdida de detección ES un re-encuadre (página retirada).
      this.rearmNeeded = false;
      this.emit(null, null);
      if (
        this.firstAttemptMs &&
        this.noDetectNotices < MAX_NO_DETECT_NOTICES &&
        detectionTimedOut(this.firstAttemptMs, now) &&
        now - this.lastNoDetectNotice > NO_DETECT_TIMEOUT_MS
      ) {
        this.lastNoDetectNotice = now;
        this.noDetectNotices += 1;
        cb.onNoDetectTimeout();
      }
      return;
    }

    // B9: hay detección → re-arra el reloj del aviso (si el papel se retira
    // más tarde, el timeout cuenta desde la ÚLTIMA detección, no del start).
    this.firstAttemptMs = now;

    // Quad en px de proceso (contrato de stability: 400-clase).
    const quadPx: Quad = [
      { x: corners[0]!.x * procW, y: corners[0]!.y * procH },
      { x: corners[1]!.x * procW, y: corners[1]!.y * procH },
      { x: corners[2]!.x * procW, y: corners[2]!.y * procH },
      { x: corners[3]!.x * procW, y: corners[3]!.y * procH },
    ];
    this.quadHistory.push({ t: now, quad: quadPx });
    this.quadHistory = this.quadHistory.filter(
      (s) => now - s.t <= 2000
    );
    if (this.quadHistory.length > MAX_HISTORY) {
      this.quadHistory = this.quadHistory.slice(-MAX_HISTORY);
    }

    // Componentes del score (fórmula exacta del usuario).
    const lapVar = out?.quality.laplacianVar ?? 0;
    const sharpness = computeSharpnessScore(lapVar);
    const exposure = hist.length === 256 ? computeExposureScore(hist) : { score: 0.5, specularRatio: 0, specularWarn: false };
    const stability = computeStabilityScore(this.quadHistory, now);
    const eccentricity = computeEccentricityScore(corners, procW, procH);
    const score = computeTotalScore(
      { sharpness, exposure: exposure.score, stability, eccentricity },
      lapVar,
      exposure.specularRatio
    );

    this.scoreHistory.push({ t: now, score: score.total });
    this.scoreHistory = this.scoreHistory.filter(
      (s) => now - s.t <= 2000
    );
    if (this.scoreHistory.length > MAX_HISTORY) {
      this.scoreHistory = this.scoreHistory.slice(-MAX_HISTORY);
    }

    this.emit(corners, score);

    // Re-encuadre: el score cayó bajo el umbral → el usuario movió/cambió
    // la página → el trigger puede volver a armarse.
    if (this.rearmNeeded && score.total <= SHUTTER_SCORE) {
      this.rearmNeeded = false;
    }

    // Disparo k-de-n (con cooldown post-captura del usuario: 1500 ms).
    if (
      !this.rearmNeeded &&
      this.scoreHistory.length > 0 &&
      now - this.lastTriggerMs > CAPTURE_COOLDOWN_MS &&
      shouldTriggerShutter(this.scoreHistory)
    ) {
      // F-STAB: Verificar quietud del dispositivo mediante el estabilizador.
      // Bloquear auto-captura si el dispositivo todavía está en movimiento
      // (la mano se acomoda / temblor muscular 4–8 Hz) — el trigger se
      // re-evalúa en el siguiente frame sin consumir el historial.
      const motion = this.stabilizer.isDeviceStable(280);
      if (!motion.stable) {
        return;
      }
      this.lastTriggerMs = now;
      this.scoreHistory = [];
      this.rearmNeeded = true;
      cb.onTrigger();
    }
  }

  private emit(corners: Quad | null, score: QualityScore | null): void {
    this.cb?.onFrame({
      corners,
      score,
      fps: this.fpsWindow.length,
      dropped: this.dropped,
      processed: this.processed,
      precision: this.client?.isReady ?? false,
    });
  }
}

// ─── Cámara sintética (port del concepto fakeCamera.ts del usuario) ─────────

/**
 * Cámara sintética para demo/QA sin hardware: canvas que dibuja la foto de
 * prueba (public/qa/test-doc.jpg) con wobble sutil de "mano sostenida"
 * (±0.15% posición, ±0.2° rotación, zoom lento) y captureStream(12).
 *
 * La detección en vivo ve frames REALES del documento en movimiento —
 * exactamente el patrón ?fake=1 del proyecto original, y a la vez la escena
 * de demo visualmente cálida del diseño 1.
 */
export class SyntheticCamera {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private raf = 0;
  private img: HTMLImageElement | null = null;
  private t0 = 0;
  private running = false;
  /** Throttle de dibujo (~30 fps): a 1920×2560, rAF a 60 fps es CPU gastada
   *  — el track captureStream(12) muestrea 12 fps para detección igual. */
  private lastDraw = 0;

  /** Arranca y devuelve el MediaStream del canvas (12 fps). */
  async start(): Promise<MediaStream | null> {
    if (this.running) return this.stream;
    if (typeof document === "undefined" || typeof MediaStreamTrack === "undefined") {
      return null;
    }
    const canvas = document.createElement("canvas");
    // 3:4 — típico de cámara trasera en portrait. RESOLUCIÓN DE SENSOR
    // (1920×2560): las capturas del stream sintético salen a calidad de
    // cámara real (grabVideoFrame lee video.videoWidth) — el pipeline
    // detect→warp→enhance se ejercita como en un teléfono de verdad,
    // no sobre un preview VGA de 640px.
    canvas.width = 1920;
    canvas.height = 2560;
    this.ctx = canvas.getContext("2d", { willReadFrequently: false });
    if (!this.ctx) return null;
    this.canvas = canvas;

    // Carga la foto de prueba si existe (ruta RELATIVA: sirve en dev en
    // raíz y bajo el basePath /web-scanner de GitHub Pages). Fallback:
    // factura demo HI-RES (1920×2580) generada en memoria — antes este
    // fallback devolvía null y la app caía a "simulated" con capturas VGA.
    const loaded = await new Promise<boolean>((resolve) => {
      const im = new Image();
      im.onload = () => {
        this.img = im;
        resolve(true);
      };
      im.onerror = () => resolve(false);
      im.src = "qa/test-doc.jpg";
    });
    if (!loaded || !this.img) {
      try {
        const im = new Image();
        await new Promise<void>((resolve, reject) => {
          im.onload = () => resolve();
          im.onerror = () => reject(new Error("demo img falló"));
          im.src = generateDemoPage(1);
        });
        this.img = im;
      } catch {
        return null;
      }
    }

    try {
      this.stream = canvas.captureStream(12);
    } catch {
      return null;
    }
    this.running = true;
    this.t0 = performance.now();
    this.draw();
    return this.stream;
  }

  private draw = (): void => {
    if (!this.running || !this.ctx || !this.canvas || !this.img) return;
    const now = performance.now();
    if (now - this.lastDraw < 33) {
      this.raf = requestAnimationFrame(this.draw);
      return;
    }
    this.lastDraw = now;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const t = (performance.now() - this.t0) / 1000;

    // Fondo cálido "escritorio" (estética del diseño 1) con flicker leve.
    const warmth = 0.96 + 0.04 * Math.sin(t * 1.7);
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, `rgb(${Math.round(88 * warmth)}, ${Math.round(70 * warmth)}, ${Math.round(52 * warmth)})`);
    g.addColorStop(0.5, `rgb(${Math.round(66 * warmth)}, ${Math.round(52 * warmth)}, ${Math.round(38 * warmth)})`);
    g.addColorStop(1, `rgb(${Math.round(46 * warmth)}, ${Math.round(36 * warmth)}, ${Math.round(26 * warmth)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // "Mano sostenida": wobble sutil (±0.15% pos, ±0.2°) sobre la escena
    // CONTENIDA con márgenes — el documento queda siempre dentro del área
    // visible de cualquier visor (object-cover recorta hasta ~15% por lado).
    const wobbleX = Math.sin(t * 0.9) * W * 0.0015;
    const wobbleY = Math.cos(t * 0.7) * H * 0.0015;
    const zoom = 0.94 + 0.02 * Math.sin(t * 0.23);
    const rot = (Math.sin(t * 0.55) * 0.2 * Math.PI) / 180;

    ctx.save();
    ctx.translate(W / 2 + wobbleX, H / 2 + wobbleY);
    ctx.rotate(rot);
    // brightness 0.85: el papel queda ~luma 208 (< 225) como una cámara
    // real con auto-exposición — la métrica de exposición del usuario respira.
    ctx.filter = "brightness(0.85) contrast(1.02)";
    // Contain: la escena completa cabe con margen de madera alrededor.
    const s = Math.min(W / this.img.width, H / this.img.height) * zoom;
    const dw = this.img.width * s;
    const dh = this.img.height * s;
    ctx.drawImage(this.img, -dw / 2, -dh / 2, dw, dh);
    ctx.filter = "none";
    ctx.restore();

    // Viñeta de profundidad (radial suave).
    const v = ctx.createRadialGradient(
      W / 2,
      H * 0.42,
      W * 0.25,
      W / 2,
      H * 0.5,
      W * 0.85
    );
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);

    this.raf = requestAnimationFrame(this.draw);
  };

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.img = null;
    this.ctx = null;
    this.canvas = null;
  }
}
