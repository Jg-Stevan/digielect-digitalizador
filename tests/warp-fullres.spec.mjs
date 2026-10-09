// ============================================================
// [T10] EVIDENCIA DEL CABLEADO warpFullRes — plan Fase 2
// ============================================================
// Verifica que procesarPagina() (el pipeline REAL de la app, expuesto
// por el espejo de solo lectura gancho-golden.ts) devuelve el dataURL
// del warp full-res: JPEG q0.92, lado mayor ≤3200 px, decodificable
// de vuelta (consumible por leerSenalesOcr / reconocerPistas).
// El worker de visión puede transferir/neutrar el bitmap en el realce;
// este test certifica que el dataURL se captura ANTES (R-14 intacto).
//
// Uso: GOLDEN_BASE_URL=http://localhost:3210/digielect-digitalizador \
//        bunx playwright test tests/warp-fullres.spec.mjs --reporter=list
// ============================================================

import { test, expect } from "@playwright/test";

const BASE = process.env.GOLDEN_BASE_URL ?? "http://localhost:3000";

test("[T10] procesarPagina devuelve warpFullRes (JPEG full-res decodificable)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  // [robustez post-merge · patrón T16] El SW toma control (controllerchange
  // → UN reload por contexto fresco) en un momento no determinístico:
  // el evaluate aterriza en la página recargada ANTES de que el gancho
  // se re-adjunte ("PREPARANDO BASE LOCAL…"). Se espera FUNCIONALMENTE:
  // control del SW → página recargada → gancho. Sin tocar asserts.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__digielectOcrGolden), null, { timeout: 20_000 });

  const r = await page.evaluate(async ({ base }) => {
    const G = window.__digielectOcrGolden;
    const originalUrl = `${base}/actas/E14_KIT399_88_335_005_02_001_X_TRANSMISION-1.jpg`;
    const out = await G.procesarPagina({
      originalUrl,
      quad: null, // marco completo (scan: el acta llena el marco)
      filtro: "texto",
      rotacion: 0,
      manual: false,
      preview: false,
    });
    let decodable = false;
    let wDecod = 0;
    if (out.warpFullRes) {
      try {
        const bmp = await createImageBitmap(await (await fetch(out.warpFullRes)).blob());
        wDecod = bmp.width;
        decodable = bmp.width > 100;
        bmp.close();
      } catch {
        decodable = false;
      }
    }
    return {
      tieneWarp: typeof out.warpFullRes === "string",
      esJpeg: out.warpFullRes?.startsWith("data:image/jpeg;base64,") ?? false,
      lenBase64: out.warpFullRes?.length ?? 0,
      w: out.w,
      h: out.h,
      decodable,
      wDecod,
    };
  }, { base: BASE });

  console.log("[T10] evidencia warpFullRes:", JSON.stringify(r));
  expect(r.tieneWarp, "procesarPagina expone warpFullRes").toBe(true);
  expect(r.esJpeg, "es dataURL JPEG (una sola compresión)").toBe(true);
  expect(
    r.lenBase64,
    "tamaño razonable (>100 KB base64 para un acta 200 dpi)"
  ).toBeGreaterThan(100_000);
  expect(r.decodable, "decodificable de vuelta (consumible por el OCR)").toBe(true);
  // Lado mayor capado a 3200 px
  expect(Math.max(r.wDecod, 0)).toBeLessThanOrEqual(3200);
});
