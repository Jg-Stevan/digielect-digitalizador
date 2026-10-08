"use client";

// ============================================================
// DIGITALIZADOR E-14 — Puente con el motor web-scanner (Fase 4)
// ============================================================
// Puente digitalizador ⇄ detection-worker.js (web-scanner).
// Protocolo: In detect|warp|enhance|config · Out result|warped|enhanced|busy|boot|ready|error
// Correlación por ts · corners en fracciones 0–1 · backpressure por DESCARTE (1 en vuelo).
// ============================================================

import { withBasePath } from "@/lib/env";
import { MOTOR_VERSION } from "@/lib/motor-version";
import type { Quad, Punto } from "@/lib/contrato/types";

export type { Quad, Punto };

type Pendiente = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const TIMEOUTS = { detect: 5_000, warp: 20_000, enhance: 15_000 } as const;
const MAX_REINTENTOS_INIT = 3;

export class BusyError extends Error {}
export class WorkerNoDisponibleError extends Error {}

export class ScannerAdapter {
  private worker: Worker | null = null;
  private pendientes = new Map<number, Pendiente>();
  private seq = 0;               // genera ts únicos
  private initIntentos = 0;
  private lista: Promise<boolean> | null = null;
  private muerto = false;

  get disponible(): boolean { return !this.muerto; }

  /** Resuelve cuando el worker cargó OpenCV (mensaje `ready`). */
  esperarListo(): Promise<boolean> {
    if (this.muerto) return Promise.resolve(false);
    if (this.lista) return this.lista;
    this.lista = new Promise<boolean>((resolve) => {
      let w: Worker;
      try {
        w = new Worker(withBasePath("/scanner/detection-worker.js") + "?v=" + MOTOR_VERSION);
      } catch {
        this.muerto = true; return resolve(false);
      }
      const arranque = setTimeout(() => { this.fallarTodo("timeout de arranque"); resolve(false); }, 25_000);
      w.onmessage = (ev: MessageEvent) => {
        const m = (ev.data ?? {}) as { type?: string };
        if (m.type === "ready") {
          clearTimeout(arranque);
          this.initIntentos = 0;
          this.worker = w;
          this.conectar(w);
          resolve(true);
        }
        // boot/ready antes de conectar: sólo nos interesa ready
      };
      w.onerror = () => {
        clearTimeout(arranque);
        this.fallarTodo("worker caído en arranque");
        resolve(false);
      };
    });
    return this.lista;
  }

  private conectar(w: Worker) {
    w.onmessage = (ev: MessageEvent) => {
      const m = (ev.data ?? {}) as Record<string, unknown> & { type?: string; ts?: number };
      const ts = typeof m.ts === "number" ? m.ts : -1;
      const p = this.pendientes.get(ts);
      switch (m.type) {
        case "result":
          p?.resolve({ corners: m.corners ?? null, qualityInput: m.qualityInput ?? null });
          break;
        case "warped":
          p?.resolve(m);
          break;
        case "enhanced":
          p?.resolve(m);
          break;
        case "busy":
          p?.reject(new BusyError("worker ocupado — descartar intento"));
          break;
        case "error":
          p?.reject(new Error(String(m.message ?? "error del worker"))); // campo ES `message`
          break;
        default:
          break; // boot u otros: ignorar post-arranque
      }
      if (p) this.pendientes.delete(ts);
    };
    w.onerror = () => {
      this.fallarTodo("worker caído");
      this.worker = null;
      this.lista = null; // permite re-init en la próxima llamada (hasta MAX_REINTENTOS_INIT)
      this.initIntentos++;
      if (this.initIntentos >= MAX_REINTENTOS_INIT) this.muerto = true;
    };
  }

  private fallarTodo(motivo: string) {
    for (const [, p] of this.pendientes) { clearTimeout(p.timer); p.reject(new Error(motivo)); }
    this.pendientes.clear();
  }

  private enviar<T>(msg: Record<string, unknown>, transfer: Transferable[], timeoutMs: number): Promise<T> {
    if (!this.worker) return Promise.reject(new WorkerNoDisponibleError());
    const ts = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendientes.delete(ts);
        reject(new Error(`timeout del worker (${timeoutMs} ms)`));
      }, timeoutMs);
      this.pendientes.set(ts, { resolve: resolve as (v: unknown) => void, reject, timer });
      try { this.worker!.postMessage({ ...msg, ts }, transfer); }
      catch (e) { clearTimeout(timer); this.pendientes.delete(ts); reject(e instanceof Error ? e : new Error("postMessage falló")); }
    });
  }

  private async aBitmap(buf: ArrayBuffer, w: number, h: number): Promise<ImageBitmap> {
    // buf queda en propiedad del llamador (createImageBitmap copia)
    return createImageBitmap(new ImageData(new Uint8ClampedArray(buf), w, h));
  }

  /** Fracciones 0–1 (8 floats TL,TR,BR,BL) → Quad de fracciones [Punto×4]. */
  private fraccionesAQuad(c: Float32Array | null): Quad | null {
    if (!c || c.length !== 8) return null;
    const p = (i: number): Punto => ({ x: c[2 * i], y: c[2 * i + 1] });
    return [p(0), p(1), p(2), p(3)];
  }

  /** Quad de fracciones → Float32Array(8) para warp. */
  private quadAFracciones(q: Quad): Float32Array {
    const out = new Float32Array(8);
    q.forEach((pt, i) => { out[2 * i] = pt.x; out[2 * i + 1] = pt.y; });
    return out;
  }

  /** Detección de bordes. Devuelve quad en FRACCIONES (contrato digielect) o null. */
  async detectar(buf: ArrayBuffer, w: number, h: number): Promise<{ quad: Quad | null; fullFrame: boolean }> {
    if (!(await this.esperarListo()) || !this.worker) throw new WorkerNoDisponibleError();
    const bitmap = await this.aBitmap(buf, w, h);
    try {
      const r = await this.enviar<{ corners: Float32Array | null }>(
        { type: "detect", bitmap }, [bitmap], TIMEOUTS.detect);
      const quad = this.fraccionesAQuad(r.corners);
      return { quad, fullFrame: quad === null };
    } catch (e) {
      if (e instanceof BusyError) throw e; // el frame loop lo descarta y sigue
      return { quad: null, fullFrame: true }; // degradación controlada
    }
  }

  /** Warp de perspectiva. quad en FRACCIONES. manual=true → el worker NO encoge 3.5 px. */
  async warp(buf: ArrayBuffer, w: number, h: number, quad: Quad, manual: boolean, maxWarpLongSide = 3200): Promise<{
    bitmap: ImageBitmap; ancho: number; alto: number; quadRefinado: Quad | null;
  }> {
    if (!(await this.esperarListo()) || !this.worker) throw new WorkerNoDisponibleError();
    const bitmap = await this.aBitmap(buf, w, h);
    try {
      const r = await this.enviar<{ bitmap: ImageBitmap; w: number; h: number; refinedQuad: Float32Array | null }>(
        { type: "warp", bitmap, quad: this.quadAFracciones(quad), manual, maxWarpLongSide },
        [bitmap], TIMEOUTS.warp);
      return { bitmap: r.bitmap, ancho: r.w, alto: r.h, quadRefinado: this.fraccionesAQuad(r.refinedQuad) };
    } finally { /* el worker cierra el bitmap de entrada */ }
  }

  /** Realce/filtro sobre el bitmap warpado. filtro ya mapeado ("raw"|"text"|"bw"). */
  async realzar(bitmap: ImageBitmap, modo: "raw" | "text" | "bw", maxLongSide = 0): Promise<{
    blob: Blob; mime: string; ancho: number; alto: number;
  }> {
    if (!this.worker) throw new WorkerNoDisponibleError();
    const r = await this.enviar<{ blob: Blob; mime: string; w: number; h: number }>(
      { type: "enhance", bitmap, mode: modo, maxLongSide }, [bitmap], TIMEOUTS.enhance);
    return { blob: r.blob, mime: r.mime, ancho: r.w, alto: r.h };
  }

  /** Config del worker (llamar 1 vez tras ready). E-14 = página fija. */
  async configurar(opts: { docProfile?: "pagina" | "tarjeta" | "auto"; maxWarpLongSide?: number } = {}): Promise<void> {
    if (!(await this.esperarListo()) || !this.worker) return;
    await this.enviar({ type: "config", docProfile: opts.docProfile ?? "pagina", maxWarpLongSide: opts.maxWarpLongSide ?? 3200 }, [], 3_000)
      .catch(() => void 0); // config es best-effort
  }
}

export const scannerAdapter = new ScannerAdapter();
