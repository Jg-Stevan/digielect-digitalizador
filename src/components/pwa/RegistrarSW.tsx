"use client";

// ============================================================
// DIGITALIZADOR E-14 — Registro del Service Worker (Fase 8)
// · SW versionado por build (scripts/gen-sw.mjs): publicar una
//   versión nueva = caché nueva.
// · El SW NO hace skipWaiting silencioso: al detectar una
//   actualización (updatefound → waiting) la app muestra el
//   banner "Nueva versión disponible — Reiniciar".
// · El banner vive en <ActualizarAppBanner/>; este componente
//   solo registra y expone el estado vía un evento DOM simple
//   (setActualizarDisponible en window).
// ============================================================

import { useEffect } from "react";
import { withBasePath } from "@/lib/env";

export type EstadoActualizacion =
  | { fase: "sin-novedad" }
  | { fase: "instalando" }
  | { fase: "lista"; aplicar: () => void };

declare global {
  interface Window {
    __swActualizar?: EstadoActualizacion;
    __swAvisar?: () => void;
  }
}

export function RegistrarSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const avisar = () => window.__swAvisar?.();

    const registrar = () => {
      navigator.serviceWorker
        .register(withBasePath("/sw.js"))
        .then((reg) => {
          // Actualización ya esperando (registrada en visitas previas)
          if (reg.waiting && navigator.serviceWorker.controller) {
            window.__swActualizar = { fase: "lista", aplicar: () => reg.waiting?.postMessage({ tipo: "ACTUALIZAR" }) };
            avisar();
          }
          // Nueva versión descargándose en ESTA visita
          reg.addEventListener("updatefound", () => {
            const nuevo = reg.installing;
            if (!nuevo) return;
            nuevo.addEventListener("statechange", () => {
              if (nuevo.state === "installed" && navigator.serviceWorker.controller) {
                window.__swActualizar = { fase: "lista", aplicar: () => nuevo.postMessage({ tipo: "ACTUALIZAR" }) };
                avisar();
              }
            });
          });
          // Recargar cuando el nuevo SW tome el control
          let recargando = false;
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (recargando) return;
            recargando = true;
            window.location.reload();
          });
        })
        .catch(() => {
          /* sin SW: la PWA sigue funcionando en línea */
        });
    };

    if (document.readyState === "complete") {
      registrar();
      return;
    }
    window.addEventListener("load", registrar, { once: true });
    return () => window.removeEventListener("load", registrar);
  }, []);

  return null;
}
