/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * F-PWA — instalación de la app (PWA) en el móvil.
 *
 * · Android/Chrome desktop: captura `beforeinstallprompt` → Ajustes muestra
 *   el botón "Instalar app" que dispara el prompt nativo.
 * · iOS Safari: no existe el prompt — se detecta y Ajustes muestra las
 *   instrucciones de "Añadir a pantalla de inicio".
 * · Registro del Service Worker SOLO en producción (https o GitHub Pages):
 *   en localhost dev interferiría con HMR.
 */

export interface PwaInstallState {
  /** El navegador puede mostrar el prompt nativo de instalación. */
  canPrompt: boolean;
  /** La app ya corre instalada (display-mode standalone). */
  installed: boolean;
  /** iOS/iPadOS (Safari): instalación vía Compartir → Añadir a inicio. */
  isIos: boolean;
  /** Escritorio. */
  isDesktop: boolean;
}

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<(state: PwaInstallState) => void>();

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true ||
    nav.standalone === true
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
}

function emit(): void {
  const state = getPwaInstallState();
  for (const fn of listeners) fn(state);
}

/** Se llama UNA VEZ desde el componente de registro (client). */
export function setupPwaListeners(): void {
  if (typeof window === "undefined") return;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPromptEvent;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emit();
  });

  // display-mode cambia al instalarse (iOS incluido al volver a abrir).
  window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", emit);
}

export function getPwaInstallState(): PwaInstallState {
  const ios = isIosDevice();
  return {
    canPrompt: deferredPrompt !== null,
    installed: isStandalone(),
    isIos: ios,
    isDesktop: !ios && typeof window !== "undefined" && !/Android/i.test(navigator.userAgent),
  };
}

export function subscribePwaState(fn: (state: PwaInstallState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Dispara el prompt nativo. "unavailable" → usar instrucciones manuales. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  try {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    emit();
    return outcome;
  } catch {
    return "unavailable";
  }
}

/** Registra el Service Worker (producción: https/distinto de localhost). */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (window.location.protocol !== "https:") return; // GitHub Pages es https; localhost dev se salta
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const register = () => {
    navigator.serviceWorker.register(`${base}/sw.js`).catch(() => {
      /* sin SW la app funciona igual (solo pierde el offline) */
    });
  };
  // B15: el listener "load" vive dentro de un efecto — si la hidratación
  // llega DESPUÉS del evento load (gama baja / red lenta), nunca dispara y
  // la app se queda sin offline. Si ya cargó, registrar inmediatamente.
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
