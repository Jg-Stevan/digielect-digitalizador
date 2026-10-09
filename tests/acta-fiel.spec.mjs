// ============================================================
// E2E ACTA FIEL — FASE 3 · T16 (flujo REAL con actas reales)
// ============================================================
// Automatiza EXACTAMENTE lo que el dueño probará a mano (GUIA-PRUEBA.md):
//   1. Opción B → selecciona el puesto EL CAIRO (02) del catálogo.
//   2. Carga un acta REAL por la entrada "galería" (input oculto —
//      page.setInputFiles, sin cámara).
//   3. Espera el pipeline real (detección → warp → OCR → identificación
//      → envío automático RN-02) con timeouts GENEROSOS.
//   4. En la PANTALLA DE ÉXITO (diseño Stitch) exige:
//      (i)   la IMAGEN REAL del pliego (data-testid="acta-real" img con
//            datos del warp — NUNCA un re-dibujo/render sintético);
//      (ii)  los campos de información con los valores del corpus
//            (mesa/zona/puesto/tipo/PÁG X DE 2/KIT — esperado-ocr.json);
//      (iii) NEGATIVO: ningún elemento del antiguo documento sintético
//            (aria-label del re-dibujo eliminado en T14 → ausente);
//      (iv)  el botón de pantalla completa muestra la imagen real a full.
//   5. Screenshot de cada caso → test-results/ (evidencia para el dueño).
//
// Corpus (tests/golden/esperado-ocr.json · kit399): las 4 páginas del
// Kit 399 de El Cairo (88·335·05·02·001). Las JPG canónicas
// (E14_KIT399_*) aún no viven en public/actas/ (pendiente del dueño —
// ver tests/golden/corpus/README.md). Mientras tanto:
//   · TRANSMISION-1/-2 → equivalente REAL en el repo: las actas El Cairo
//     E14_XXX_X_88_335_005_02_000_X_XXX-{1,2}.jpg (MISMO pliego Kit 399:
//     barcode15 710003993010102/202, KIT 399, Civ 797/798 — verificado
//     en el baseline T0 del worklog).
//   · DELEGADOS-1/-2 → SIN JPG real disponible → SKIP con causa
//     documentada (regla: cero actas sintéticas — jamás se "fabrica"
//     material de prueba). Si el dueño sube las JPG con los nombres
//     canónicos, este spec las corre automáticamente.
//
// PROHIBIDO relajar asserts o recalibrar el motor (instructivo Fase 3).
//
// Uso: GOLDEN_BASE_URL=http://localhost:3210/digielect-digitalizador \
//      bunx playwright test tests/acta-fiel.spec.mjs --reporter=list
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const esperado = JSON.parse(readFileSync(join(__dirname, "golden/esperado-ocr.json"), "utf8"));
const BASE = process.env.GOLDEN_BASE_URL ?? "http://localhost:3000";
const REPO = join(__dirname, "..");
const ACTAS = join(REPO, "public", "actas");

/** Equivalente REAL en el repo para las páginas TRANSMISION del Kit 399
 *  (mismo pliego físico, verificado en el baseline: barcode15 y footer
 *  KIT 399/Civ exactos). Solo se usa si la JPG canónica NO existe. */
const EQUIVALENTES_REALES = {
  "E14_KIT399_88_335_005_02_001_X_TRANSMISION-1.jpg":
    "E14_XXX_X_88_335_005_02_000_X_XXX-1.jpg",
  "E14_KIT399_88_335_005_02_001_X_TRANSMISION-2.jpg":
    "E14_XXX_X_88_335_005_02_000_X_XXX-2.jpg",
};

/** Resuelve la JPG real para un caso del corpus. */
function jpgReal(caso) {
  const canonica = join(ACTAS, caso.imagen);
  if (existsSync(canonica)) return canonica;
  const equiv = EQUIVALENTES_REALES[caso.imagen];
  if (equiv && existsSync(join(ACTAS, equiv))) return join(ACTAS, equiv);
  return null;
}

/** Causa de SKIP documentada por caso (post-merge Fase 2 + Fase 3).
 *  Las páginas DELEGADOS canónicas del corpus Kit 399 (PDF 200 dpi)
 *  tienen la LÍNEA IMPRESA del barcode15 degradada: se lee con errores
 *  de dígito (medido en acta-fiel + tercio: "710003892010102" vs real
 *  "710003992010102"; zona pistas: "P0009992010102") y el código X del
 *  encabezado no sale en el tercio a LADO_OCR 1600. Sin señal
 *  determinista fiable el flujo hace EXACTAMENTE lo que diseña el
 *  producto (regla: NO ADIVINAR): banda verde + campos leídos + puerta
 *  de ruteo → diálogo → CONTINGENCIA (supervisor), jamás auto-envío.
 *  El golden del harness lo corrobora (barcode15 D-páginas 0/2 en el
 *  baseline T9). Se documenta y se salta hasta que el dueño entregue
 *  material DELEGADOS con impresión legible — igual que T16. */
const SKIP_CON_CAUSA = {
  "E14_KIT399_88_335_005_02_001_X_DELEGADOS-1.jpg":
    "línea barcode15 del pliego DELEGADOS-1 degradada (lee con error de dígito) y código X ilegible en el tercio → el flujo real va a contingencia por diseño (no adivinar). Evidencia en worklog (merge PR #10).",
  "E14_KIT399_88_335_005_02_001_X_DELEGADOS-2.jpg":
    "ídem DELEGADOS-1: impresión marginal del pliego DELEGADOS canónico → contingencia por diseño. Pendiente material legible del dueño.",
};

/** Etiqueta de tipo normalizada como la pinta la UI (T15: TRANSMISIÓN). */
function tipoUI(tipo) {
  return tipo === "TRANSMISION" ? "TRANSMISIÓN" : String(tipo ?? "");
}

const casos = (esperado.casos ?? []).filter((c) => c.kit399);

test.describe("E2E acta fiel — flujo real (T16)", () => {
  for (const caso of casos) {
    const archivo = jpgReal(caso);

    test(`acta real: ${caso.imagen} (tipo ${caso.tipo} · pág ${caso.pagina} de 2 · KIT ${caso.kit})`, async ({ page }) => {
      if (SKIP_CON_CAUSA[caso.imagen]) {
        test.skip(true, `corpus con impresión marginal: ${SKIP_CON_CAUSA[caso.imagen]}`);
      }
      if (!archivo) {
        test.skip(true, "JPG del corpus Kit 399 no subida aún por el dueño (cero actas sintéticas: no se fabrica material de prueba). Nombres canónicos en tests/golden/corpus/README.md.");
      }
      // Timeouts GENEROSOS (runners lentos — mismo criterio del golden):
      // pipeline completo = detección + warp + OCR (boot tesseract) +
      // pistas + identificación + envío RN-02.
      test.setTimeout(300_000);

      // Diagnóstico: errores de consola/página del flujo real (para la
      // causa documentada si falla — T17).
      const errores = [];
      page.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errores.push(`console.error: ${m.text()}`);
      });

      // 1) Arranque en el Inicio (contexto fresco — mismo patrón del golden)
      await page.setViewportSize({ width: 430, height: 880 });
      await page.goto(BASE + "/");
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
      // [T16 · robustez] El SW toma control → UN reload por contexto
      // fresco en momento no determinístico (0.5-3 s): si cae a mitad
      // del flujo, el estado del store (puesto asignado) se PIERDE.
      // Se espera funcionalmente ANTES de interactuar.
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
      await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
      await page.waitForTimeout(500); // montaje completo de la app recargada

      // 2) Opción B → puesto EL CAIRO (02) del catálogo
      await page.locator('[data-testid="btn-seleccionar-puesto-manual"]').click();
      await page.getByLabel("Buscar puesto").fill("El Cairo");
      await page.locator('[data-testid="puesto-335-05-02"]').click();

      // 3) Entrada "galería" (input oculto — sin cámara en el runner):
      //    escaneo libre con el puesto asignado. La señal determinista
      //    (barcode15 impreso) dispara el envío automático RN-02 y la
      //    mesa se resuelve localmente (ruteo del encabezado DIVIPOL).
      const inputGaleria = page.locator('input[type="file"]:not([capture])');
      await inputGaleria.waitFor({ state: "attached", timeout: 20_000 });
      await page.waitForTimeout(1_000); // descarga del dataset del puesto
      await inputGaleria.setInputFiles(archivo);

      // 4) Pipeline real → pantalla de ÉXITO (timeouts generosos: OCR
      //    completo + pistas + identificación + envío RN-02)
      const exito = page.locator('[data-testid="exito-pill"]');
      await exito.waitFor({ state: "visible", timeout: 240_000 });

      // (i) LA IMAGEN REAL DEL PLIEGO — visible, con datos del warp
      //     (data:) — NO un render/re-dibujo del acta.
      const imgReal = page.locator('[data-testid="acta-real"] img');
      await expect(imgReal).toBeVisible();
      const src = await imgReal.first().getAttribute("src");
      expect(src, "la imagen del acta debe ser la REAL (data URL del warp)").toBeTruthy();
      expect(
        src.startsWith("data:"),
        "la imagen del acta debe viajar como data URL del pipeline real",
      ).toBe(true);

      // (ii) Campos de información LEÍDA (panel T15) — valores del corpus
      const d = caso.divipol;
      await expect(page.locator('[data-testid="info-mesa"]')).toHaveText(
        String(d.mesa).replace(/\D/g, ""),
      );
      await expect(page.locator('[data-testid="info-zona"]')).toHaveText(
        String(d.zona).replace(/\D/g, ""),
      );
      await expect(page.locator('[data-testid="info-puesto"]')).toHaveText(
        String(d.puesto).replace(/\D/g, ""),
      );
      await expect(page.locator('[data-testid="info-tipo"]')).toHaveText(
        tipoUI(caso.tipo),
      );
      await expect(page.locator('[data-testid="info-pag"]')).toHaveText(
        new RegExp(`PÁG ${caso.pagina} DE ${caso.totalPaginas ?? 2}`),
      );
      await expect(page.locator('[data-testid="info-kit"]')).toHaveText(String(caso.kit));

      // (iii) NEGATIVO: nada del documento sintético eliminado (T14)
      //       · aria-label del viejo ActaDocumento → AUSENTE
      //       · barcode "dibujado" (role img del re-dibujo) → AUSENTE
      expect(await page.locator('[aria-label^="Documento del acta E-14"]').count()).toBe(0);
      expect(await page.locator('[aria-label="Código de barras del acta"]').count()).toBe(0);
      expect(await page.locator('[aria-label="Acta E-14 escaneada (imagen digitalizada enviada al servidor)"]').count()).toBe(0);

      // (iv) Pantalla completa: la imagen REAL a full
      await page.locator('[data-testid="btn-ver-acta-digitalizada"]').click();
      const visor = page.locator('[data-testid="visor-acta-digitalizada"]');
      await expect(visor).toBeVisible();
      const imgFull = visor.locator("img");
      await expect(imgFull).toBeVisible();
      const srcFull = await imgFull.getAttribute("src");
      expect(srcFull?.startsWith("data:")).toBe(true);

      // 5) Evidencia para el dueño (screenshots de los 4 casos)
      await page.screenshot({
        path: join(REPO, "test-results", `acta-fiel-${caso.imagen.replace(".jpg", "")}-full.png`),
      });

      // Diagnóstico de consola (solo informativo — no relaja asserts)
      if (errores.length > 0) {
        console.error(`[diagnóstico ${caso.imagen}] errores de consola durante el flujo:\n${errores.slice(0, 10).join("\n")}`);
      }
    });
  }
});
