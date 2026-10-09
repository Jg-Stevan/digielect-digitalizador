// TEMP-T11: evidencia del banner v2 — corre reconocerPistas REAL
// (con la cadena de candidatos + validación tipoDesdeBanner).
import { test } from "@playwright/test";

const BASE = process.env.GOLDEN_BASE_URL ?? "http://localhost:3210/digielect-digitalizador";

const IMAGENES = [
  "E14_XXX_X_88_335_005_02_000_X_XXX-2.jpg",
  "E14_XXX_X_88_495_010_02_000_X_XXX-2.jpg",
  "E14_XXX_X_88_335_005_81_000_X_XXX-2.jpg",
  "E14_XXX_X_88_355_003_08_000_X_XXX-1.jpg",
  "E14_XXX_X_88_355_003_08_000_X_XXX-2.jpg",
  "E14_KIT399_88_335_005_02_001_X_TRANSMISION-1.jpg",
  "E14_KIT399_88_335_005_02_001_X_TRANSMISION-2.jpg",
  "E14_KIT399_88_335_005_02_001_X_DELEGADOS-1.jpg",
  "E14_KIT399_88_335_005_02_001_X_DELEGADOS-2.jpg",
  "E14_XXX_X_88_335_005_02_000_X_XXX-1.jpg", // control repo (mismo layout, banner negro-sobre-blanco)
  "E14_XXX_X_88_495_010_02_000_X_XXX-1.jpg", // control repo 2
  "E14_XXX_X_88_335_005_81_000_X_XXX-1.jpg", // control repo degradada
];

test("debug banner v2: reconocerPistas real", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.__digielectOcrGolden.workerOcrRuteo());
  for (const img of IMAGENES) {
    const r = await page.evaluate(async ({ base, img }) => {
      const G = window.__digielectOcrGolden;
      const res = await fetch(`${base}/actas/${img}`);
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * Math.min(1, 3200 / Math.max(bmp.width, bmp.height)));
      c.height = Math.round(bmp.height * Math.min(1, 3200 / Math.max(bmp.width, bmp.height)));
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const dataUrl = c.toDataURL("image/jpeg", 0.95);
      c.width = 0;
      c.height = 0;
      const t0 = performance.now();
      const pistas = await G.reconocerPistas(dataUrl);
      const ms = Math.round(performance.now() - t0);
      return {
        banner: pistas?.banner ?? null,
        tipo: G.tipoDesdeBanner(pistas?.banner ?? null),
        ms,
      };
    }, { base: BASE, img });
    console.log(`=== ${img}\n    banner=${JSON.stringify(r.banner)} · tipo=${r.tipo} · ${r.ms}ms`);
  }
});
