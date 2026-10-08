// AUTO-GENERADO por scripts/gen-sw.mjs (build) — NO EDITAR A MANO.
// [FASE-8] Service Worker versionado. La versión viaja en el nombre
// de caché: publicar una versión nueva = caché nueva (sin skipWaiting
// silencioso: la app muestra el banner "Nueva versión disponible").
const VERSION = "v1.1.0+motorc225fbea";
const CACHE_SHELL = `digi-e14-shell-${VERSION}`;
const CACHE_MOTOR = `digi-e14-motor-${VERSION}`;
const CACHE_RUNTIME = `digi-e14-runtime-${VERSION}`;
const CACHE_CATALOGO = `digi-e14-catalogo-${VERSION}`;

// Shell mínimo (la ruta raíz con basePath la resuelve el scope)
const SHELL_REL = ["", "manifest.webmanifest", "icon.svg", "e14/icono-pwa.svg"];

// Motor de visión + OCR local (offline estricto — Invariante 6)
const MOTOR_URLS = [
  "scanner/detection-worker.js?v=c225fbea91ebf76bea12fe4ad355f578b4bff3d5",
  "vendor/opencv-4.5.5.js",
  "vendor/opencv-4.5.5-core.js",
  "ocr/tesseract/tesseract.min.js",
  "ocr/tesseract/worker.min.js",
  "ocr/tesseract/core/tesseract-core-lstm.wasm.js",
  "ocr/tesseract/core/tesseract-core-simd-lstm.wasm.js",
  "ocr/tessdata/spa.traineddata.gz",
];

const base = self.registration.scope;

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const shell = await caches.open(CACHE_SHELL);
      await shell.addAll(SHELL_REL.map((r) => new URL(r, base).href).filter((u) => !u.endsWith("#")));
      // El motor se precachea en PARALELO: un archivo grande fallando no
      // rompe la instalación (el activate lo reintenta por faltantes).
      const motor = await caches.open(CACHE_MOTOR);
      await Promise.allSettled(
        MOTOR_URLS.map((r) => motor.add(new URL(r, base).href).catch(() => null))
      );
    })()
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // Borrar cachés de versiones viejas
      const vivos = new Set([CACHE_SHELL, CACHE_MOTOR, CACHE_RUNTIME, CACHE_CATALOGO]);
      const nombres = await caches.keys();
      await Promise.all(nombres.filter((n) => !vivos.has(n)).map((n) => caches.delete(n)));
      // Completar faltantes del motor (instalación parcial previa)
      const motor = await caches.open(CACHE_MOTOR);
      await Promise.allSettled(
        MOTOR_URLS.map((r) => motor.match(new URL(r, base).href).then((hit) => hit || motor.add(new URL(r, base).href).catch(() => null)))
      );
      await self.clients.claim();
    })()
  );
});

// El SW NO hace skipWaiting silencioso: la app pide la actualización
// desde el banner (postMessage {tipo:"ACTUALIZAR"}) y recarga.
self.addEventListener("message", (evento) => {
  if (evento.data && evento.data.tipo === "ACTUALIZAR") {
    void self.skipWaiting();
  }
});

function esMotor(url) {
  return (
    url.pathname.includes("/scanner/") ||
    url.pathname.includes("/vendor/opencv") ||
    url.pathname.includes("/ocr/tesseract") ||
    url.pathname.includes("/ocr/tessdata")
  );
}

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 1) Motor + OCR: CACHE-FIRST (offline total)
  if (esMotor(url)) {
    evento.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copia = res.clone();
            void caches.open(CACHE_MOTOR).then((c) => c.put(req, copia));
            return res;
          })
      )
    );
    return;
  }

  // 2) Catálogo de mesas: NETWORK-FIRST con fallback a caché
  if (url.pathname.includes("/data/")) {
    evento.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          void caches.open(CACHE_CATALOGO).then((c) => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3) App shell / assets propios: cache-first con relleno runtime
  evento.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req)
          .then((res) => {
            if (res.ok && (url.pathname.includes("/_next/") || (res.headers.get("content-type") || "").includes("text/html"))) {
              const copia = res.clone();
              void caches.open(CACHE_RUNTIME).then((c) => c.put(req, copia));
            }
            return res;
          })
          .catch(() => caches.match(new URL("", base).href))
    )
  );
});
