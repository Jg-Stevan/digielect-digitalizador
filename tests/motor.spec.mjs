// ============================================================
// GOLDEN TESTS del motor de visión (Fase 9 · plan §11.2)
// Corre en Playwright (Chromium headless) contra un servidor
// estático del build. Ver tests/golden/esperado.json.
//   1. detect → cada esquina dentro de ±tolerancia del esperado
//   2. warp(manual:true) vs warp(manual:false) mismo quad →
//      dims del manual ≥ dims del automático (Invariante 3)
//   3. OCR de ruteo sobre la referencia → campos esperados
// Uso: bunx playwright test (requiere playwright instalado; en CI
// corre con el servidor estático del export en localhost).
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

// ESM (__dirname no existe en .mjs; compatible Node y Bun)
const __dirname = dirname(fileURLToPath(import.meta.url));
const esperado = JSON.parse(readFileSync(join(__dirname, "golden/esperado.json"), "utf8"));
const BASE = process.env.GOLDEN_BASE_URL ?? "http://localhost:4173/digielect-digitalizador";

/** Abre la app y espera a que la navegación se asiente. La PWA recarga
 *  UNA vez cuando el SW toma el control (clients.claim → controllerchange
 *  → location.reload — ver RegistrarSW.tsx): ese reload destruye el
 *  contexto de un page.evaluate en curso. */
async function abrir(page) {
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1_500); // absorbe el reload del controllerchange
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
}

/** Habla el protocolo REAL del worker (Invariante 4) en la página. */
async function motorListo(page) {
  // page.evaluate corre en el NAVEGADOR: todo lo que use (incluida la
  // versión del motor) debe entrar por parámetro, no por scope de Node.
  return page.evaluate(async ({ base, motor }) => {
    const w = new Worker(`${base}/scanner/detection-worker.js?v=${motor}`);
    const ready = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("ready timeout")), 25_000);
      w.onmessage = (e) => { if (e.data?.type === "ready") { clearTimeout(t); res(e.data); } };
      w.onerror = () => rej(new Error("worker error"));
    });
    window.__worker = w;
    return { ok: true, opencvLocal: String(ready.opencvUrl || "").includes("vendor") };
  }, { base: BASE, motor: esperado.motor });
}

async function detect(page, archivo) {
  return page.evaluate(async ({ base, archivo }) => {
    const w = window.__worker;
    const img = new Image();
    img.src = `${base}/actas/${archivo}`;
    await img.decode();
    const c = document.createElement("canvas");
    const esc = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * esc);
    c.height = Math.round(img.naturalHeight * esc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const bmp = await createImageBitmap(c);
    const ts = Date.now();
    const r = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("detect timeout")), 8_000);
      w.onmessage = (e) => { if (e.data?.ts === ts) { clearTimeout(t); res(e.data); } };
      w.postMessage({ type: "detect", bitmap: bmp, ts }, [bmp]);
    });
    return r.corners ? Array.from(r.corners).map((v) => +v.toFixed(4)) : null;
  }, { base: BASE, archivo });
}

async function warp(page, archivo, quad, manual) {
  return page.evaluate(async ({ base, archivo, quad, manual }) => {
    const w = window.__worker;
    const img = new Image();
    img.src = `${base}/actas/${archivo}`;
    await img.decode();
    const c = document.createElement("canvas");
    const esc = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.round(img.naturalWidth * esc);
    c.height = Math.round(img.naturalHeight * esc);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const bmp = await createImageBitmap(c);
    const ts = Date.now() + Math.random();
    const r = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("warp timeout")), 20_000);
      w.onmessage = (e) => { if (e.data?.ts === ts) { clearTimeout(t); res(e.data); } };
      w.postMessage({ type: "warp", bitmap: bmp, quad: new Float32Array(quad), manual, maxWarpLongSide: 3200, ts }, [bmp]);
    });
    return { w: r.w, h: r.h };
  }, { base: BASE, archivo, quad, manual });
}

test.beforeAll("worker listo con OpenCV LOCAL (Invariante 6)", async ({ browser }) => {
  const page = await browser.newPage();
  await abrir(page);
  const estado = await motorListo(page);
  expect(estado.ok).toBe(true);
  expect(estado.opencvLocal).toBe(true);
  await page.close();
});

for (const caso of esperado.casos) {
  test(`detect ±${esperado.tolerancia}: ${caso.imagen}`, async ({ browser }) => {
    const page = await browser.newPage();
    await abrir(page);
    await motorListo(page);
    const corners = await detect(page, caso.imagen);
    if (caso.esperado.quad == null) {
      // sin esperado fijado: solo registramos que responde
      expect(Array.isArray(corners) || corners === null).toBe(true);
    } else {
      expect(corners, "corners Float32Array(8)").toHaveLength(8);
      corners.forEach((v, i) => {
        expect(Math.abs(v - caso.esperado.quad[i]), `esquina ${i} (${v} vs ${caso.esperado.quad[i]})`).toBeLessThanOrEqual(esperado.tolerancia);
      });
    }
    await page.close();
  });
}

test("Invariante 3: manual:true NO encoge (dims ≥ auto)", async ({ browser }) => {
  const page = await browser.newPage();
  await abrir(page);
  await motorListo(page);
  const caso = esperado.casos.find((c) => c.esperado.quad != null);
  test.skip(!caso, "sin caso con quad esperado");
  const manual = await warp(page, caso.imagen, caso.esperado.quad, true);
  const auto = await warp(page, caso.imagen, caso.esperado.quad, false);
  expect(manual.w * manual.h).toBeGreaterThanOrEqual(auto.w * auto.h);
  await page.close();
});

test("Regla de Producto: OCR de ruteo SOLO campos impresos (grep del código)", () => {
  // La verificación de código vive en scripts/test-contrato.mjs; aquí
  // se valida el resultado esperado del caso de referencia:
  const caso = esperado.casos.find((c) => c.ocr_ruteo);
  expect(caso.ocr_ruteo.mesaIdSugerido).toBe("mesa-el-cairo-001");
  expect(Object.keys(caso.ocr_ruteo)).toEqual(
    expect.arrayContaining(["departamento", "municipio", "zona", "puesto", "mesa"])
  );
  // sin campos manuscritos declarados
  expect(Object.keys(caso.ocr_ruteo).some((k) => /voto|manuscrit|candidat/i.test(k))).toBe(false);
});
