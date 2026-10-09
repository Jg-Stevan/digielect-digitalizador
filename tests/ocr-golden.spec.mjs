// ============================================================
// GOLDEN OCR — plan de mejora del acta E-14 (T0 · plan-mejora §F0)
// ============================================================
// Corre el pipeline OCR REAL de la app (expuesto por
// src/lib/ocr/gancho-golden.ts en window.__digielectOcrGolden)
// sobre las actas de corpus y compara contra tests/golden/esperado-ocr.json.
//
//   · Campos DIVIPOL: normalizados a dígitos y comparados tal cual.
//   · Señales impresas (Kit 399): barcode15 impreso, Ver/Pag, KIT,
//     Civ y banner — parseados con los módulos reales.
//   · Las 4 páginas Kit 399 se SALTA si las JPG no están subidas.
//   · Imprime la TABLA de pass-rate por campo (baseline en T0) y
//     aplica el umbral de etapa (>=0.80 etapa 1 · >=0.95 etapa 2)
//     SOLO sobre los casos ejecutables.
//
// Uso: GOLDEN_BASE_URL=http://localhost:3000 bunx playwright test tests/ocr-golden.spec.mjs --reporter=list
// ============================================================

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const esperado = JSON.parse(readFileSync(join(__dirname, "golden/esperado-ocr.json"), "utf8"));
const BASE = process.env.GOLDEN_BASE_URL ?? "http://localhost:3000";
const UMBRAL = esperado.umbrales?.etapa1 ?? 0.8;

/** Fuente de OCR fiel al pipeline: si el motor detecta la PÁGINA
 *  COMPLETA (quad que cubre ≥75% del marco — foto real) usa el warp
 *  como la app; si detecta una banda interna (comportamiento conocido
 *  del upstream sobre SCANS — ver tests/golden/esperado.json) usa el
 *  scan completo: el acta llena el marco (equivale al warp
 *  marco-completo con el que están calibradas las cajas). */
async function fuenteOcr(page, base, archivo) {
  return page.evaluate(async ({ base, archivo }) => {
    const cargar = async () => {
      const img = new Image();
      img.src = `${base}/actas/${archivo}`;
      await img.decode();
      const esc = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * esc);
      c.height = Math.round(img.naturalHeight * esc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c;
    };
    const c = await cargar();
    const scanDataUrl = c.toDataURL("image/jpeg", 0.95);
    let modo = "scan-completo";
    let quad = null;
    try {
      const w = new Worker(`${base}/scanner/detection-worker.js?v=golden`);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("ready timeout")), 25_000);
        w.onmessage = (e) => { if (e.data?.type === "ready") { clearTimeout(t); res(1); } };
        w.onerror = () => rej(new Error("worker error"));
      });
      const bmp = await createImageBitmap(c);
      const ts = Date.now();
      const det = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("detect timeout")), 12_000);
        w.onmessage = (e) => { if (e.data?.ts === ts) { clearTimeout(t); res(e.data); } };
        w.postMessage({ type: "detect", bitmap: bmp, ts }, [bmp]);
      });
      if (det.corners) {
        const xs = [det.corners[0], det.corners[2], det.corners[4], det.corners[6]];
        const ys = [det.corners[1], det.corners[3], det.corners[5], det.corners[7]];
        const ancho = Math.max(...xs) - Math.min(...xs);
        const alto = Math.max(...ys) - Math.min(...ys);
        quad = Array.from(det.corners).map((v) => +v.toFixed(4));
        if (ancho >= 0.75 && alto >= 0.75) {
          const bmp2 = await createImageBitmap(c);
          const ts2 = Date.now() + 1;
          const war = await new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("warp timeout")), 25_000);
            w.onmessage = (e) => { if (e.data?.ts === ts2) { clearTimeout(t); res(e.data); } };
            w.postMessage(
              { type: "warp", bitmap: bmp2, quad: new Float32Array(det.corners), manual: false, maxWarpLongSide: 3200, ts: ts2 },
              [bmp2]
            );
          });
          const cw = document.createElement("canvas");
          cw.width = war.w;
          cw.height = war.h;
          cw.getContext("2d").drawImage(war.bitmap, 0, 0);
          war.bitmap.close && war.bitmap.close();
          const dataUrl = cw.toDataURL("image/jpeg", 0.95);
          cw.width = 0;
          cw.height = 0;
          modo = "warp-pagina-completa";
          c.width = 0;
          c.height = 0;
          w.terminate();
          return { dataUrl, quad, modo };
        }
      }
      w.terminate();
    } catch {
      /* sin worker/detect: scan completo (fail-soft) */
    }
    c.width = 0;
    c.height = 0;
    return { dataUrl: scanDataUrl, quad, modo };
  }, { base, archivo });
}

/** Normaliza a dígitos con relleno (misma idea de resolverRuteo). */
function normalizarCampo(valor, digitos) {
  const d = String(valor ?? "").replace(/\D+/g, "");
  if (!d) return null;
  return d.slice(0, digitos).padStart(digitos, "0");
}

// [T12] RUTEO RESUELTO — los rescates del ruteo (T7/T8/T12) operan en
// resolverRuteo, no en el OCR crudo: sin esta métrica el efecto de los
// rescates es invisible para el golden. Se miden DOS totales:
//   · OCR crudo (semántica T0, gate GOLDEN_STRICT sin cambiar)
//   · ruteo resuelto (los campos que la app EFECTIVAMENTE enrutaría:
//     si resolverRuteo sugiere mesa, país/zona/puesto/mesa salen del
//     catálogo verificado; departamento sigue siendo OCR crudo —
//     campo de control, no de ruteo)
async function consuladosDeCatalogo(page) {
  return page.evaluate(async (base) => {
    const res = await fetch(`${base}/data/digitalizador-bootstrap.json`);
    const data = await res.json();
    return data.consulados ?? [];
  }, BASE);
}

async function camposResueltos(page, campos, consulados) {
  return page.evaluate(({ campos, consulados }) => {
    const G = window.__digielectOcrGolden;
    const r = G.resolverRuteo(campos, consulados);
    const ef = {
      departamento: campos?.departamento?.valor ?? null,
      municipio: campos?.municipio?.valor ?? null,
      zona: campos?.zona?.valor ?? null,
      puesto: campos?.puesto?.valor ?? null,
      mesa: campos?.mesa?.valor ?? null,
    };
    if (r?.mesaIdSugerido) {
      for (const c of consulados) {
        const m = c.mesas?.find((mm) => mm.id === r.mesaIdSugerido);
        if (m) {
          const [pais, zona, puesto] = String(c.codigo ?? "").split("-");
          ef.municipio = pais;
          ef.zona = zona;
          ef.puesto = puesto;
          ef.mesa = String(m.numero).padStart(3, "0");
          break;
        }
      }
    }
    return { ef, motivo: r?.motivo ?? null, sugerido: r?.mesaIdSugerido ?? null };
  }, { campos, consulados });
}

test.beforeAll("gancho golden disponible", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_500); // absorbe el reload del Service Worker
  const hay = await page.evaluate(() => Boolean(window.__digielectOcrGolden));
  expect(hay, "window.__digielectOcrGolden expuesto por gancho-golden.ts").toBe(true);
  await page.close();
});

for (const caso of esperado.casos) {
  test(`golden OCR: ${caso.imagen}`, async ({ browser }) => {
    // CI (ubuntu-latest, 2 cores) es más lento que local: el OCR con
    // ensemble puede superar el default de 30 s por acta.
    test.setTimeout(240_000);
    // La imagen debe existir en public/actas (los Kit 399 van llegando)
    const rutaPublica = join(__dirname, "..", "public", "actas", caso.imagen);
    if (!existsSync(rutaPublica)) {
      test.info().annotations.push({ type: "SKIP", description: "corpus pendiente de subir a public/actas" });
      test.skip(true, "corpus pendiente de subir a public/actas");
      return;
    }

    const page = await browser.newPage();
    await page.goto(BASE + "/");
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.evaluate(() => window.__digielectOcrGolden.workerOcrRuteo());

    const fuente = await fuenteOcr(page, BASE, caso.imagen);
    const resultado = await page.evaluate(async ({ dataUrl }) => {
      const G = window.__digielectOcrGolden;
      const t0 = performance.now();
      const campos = await G.reconocerZonasRuteo(dataUrl, G.ZONAS_RUTEO_E14);
      const pistas = await G.reconocerPistas(dataUrl);
      const bi = G.parsearBarcodeImpreso(pistas?.barcodeImpreso ?? null);
      const ft = G.parsearFooter(pistas?.footer ?? null);
      const banner = G.tipoDesdeBanner(pistas?.banner ?? null);
      return {
        campos,
        pistas,
        bi,
        ft,
        banner,
        ms: Math.round(performance.now() - t0),
      };
    }, { dataUrl: fuente.dataUrl });

    // [T12] ruteo resuelto con el catálogo real (línea trazable por caso)
    const consulados = await consuladosDeCatalogo(page);
    const resuelto = await camposResueltos(page, resultado.campos, consulados);

    await page.close();

    // ── DIVIPOL por campo ──
    const digitosEsperados = { departamento: 2, municipio: 3, zona: 2, puesto: 2, mesa: 3 };
    const fallos = [];
    for (const [campo, nd] of Object.entries(digitosEsperados)) {
      const leido = normalizarCampo(resultado.campos?.[campo]?.valor, nd);
      const esperadoCampo = normalizarCampo(caso.divipol?.[campo], nd);
      const ok = leido != null && esperadoCampo != null && leido === esperadoCampo;
      if (!ok) fallos.push(`${campo}: leído=${leido} esperado=${esperadoCampo}`);
      console.log(`  ${ok ? "✓" : "✗"} ${campo.padEnd(12)} ${leido ?? "—"} (esperado ${esperadoCampo ?? "—"})`);
    }

    // ── Señales impresas (solo corpus Kit 399) ──
    if (caso.kit399) {
      const d15Ok = resultado.bi?.d15 === caso.barcode15;
      console.log(`  ${d15Ok ? "✓" : "✗"} barcode15    ${resultado.bi?.d15 ?? "—"} (esperado ${caso.barcode15})`);
      if (!d15Ok) fallos.push(`barcode15: leído=${resultado.bi?.d15} esperado=${caso.barcode15}`);

      const pagOk = resultado.bi?.pag === caso.pagina;
      console.log(`  ${pagOk ? "✓" : "✗"} Ver/Pag      pag=${resultado.bi?.pag ?? "—"} de=${resultado.bi?.de ?? "—"} (esperado p${caso.pagina} de 2)`);
      if (!pagOk) fallos.push(`pagina impresa: leído=${resultado.bi?.pag} esperado=${caso.pagina}`);

      const kitOk = resultado.ft?.kit === caso.kit;
      console.log(`  ${kitOk ? "✓" : "✗"} KIT footer   ${resultado.ft?.kit ?? "—"} (esperado ${caso.kit})`);
      if (!kitOk) fallos.push(`kit: leído=${resultado.ft?.kit} esperado=${caso.kit}`);

      const civOk = resultado.ft?.civ === caso.civ;
      console.log(`  ${civOk ? "✓" : "✗"} Civ footer   ${resultado.ft?.civ ?? "—"} (esperado ${caso.civ})`);
      if (!civOk) fallos.push(`civ: leído=${resultado.ft?.civ} esperado=${caso.civ}`);

      const bannerOk = resultado.banner === caso.tipo;
      console.log(`  ${bannerOk ? "✓" : "✗"} banner       ${resultado.banner ?? "—"} (esperado ${caso.tipo})`);
      if (!bannerOk) fallos.push(`banner: leído=${resultado.banner} esperado=${caso.tipo}`);
    }

    if (!fuente.quad) fallos.push("quad no detectado por el motor (scan sin fondo): OCR sobre scan crudo");
    console.log(`  ⛢ ruteo resuelto: ${resuelto.ef.municipio ?? "—"}-${resuelto.ef.zona ?? "—"}-${resuelto.ef.puesto ?? "—"} mesa ${resuelto.ef.mesa ?? "—"} · ${resuelto.sugerido ? (resuelto.motivo ?? "sugerido") : "sin sugerencia"}`);
    console.log(`  ⏱ OCR zonas+pistas: ${resultado.ms} ms · fuente: ${fuente.modo}`);
    test.info().attach("fallos", { body: fallos.length ? fallos.join("\n") : "(sin fallos)", contentType: "text/plain" });
    // T0 = MEDIR (baseline). El gate duro se activa con GOLDEN_STRICT=1
    // (CI) una vez las mejoras T1-T8 levanten el pass-rate.
    if (process.env.GOLDEN_STRICT === "1") {
      expect(fallos, fallos.join(" · ")).toHaveLength(0);
    } else {
      expect(fallos.length).toBeGreaterThanOrEqual(0); // siempre verdadero: medición
    }
  });
}

test("umbral de etapa: pass-rate global de los casos ejecutados", async ({ browser }) => {
  // Recorre los casos ejecutables (imagen presente) y verifica el
  // pass-rate de campos DIVIPOL >= umbral de etapa (0.80 etapa 1).
  // Timeout generoso: este test corre OCR sobre TODOS los casos.
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await page.goto(BASE + "/");
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await page.evaluate(() => window.__digielectOcrGolden.workerOcrRuteo());
  const consulados = await consuladosDeCatalogo(page);

  const ejecutables = esperado.casos.filter((c) =>
    existsSync(join(__dirname, "..", "public", "actas", c.imagen))
  );
  test.skip(ejecutables.length === 0, "sin corpus ejecutable");

  let total = 0;
  let ok = 0;
  let totalRes = 0;
  let okRes = 0;
  const tabla = [];
  for (const caso of ejecutables) {
    const fuente = await fuenteOcr(page, BASE, caso.imagen);
    const r = await page.evaluate(async ({ dataUrl }) => {
      const G = window.__digielectOcrGolden;
      const t0 = performance.now();
      const campos = await G.reconocerZonasRuteo(dataUrl, G.ZONAS_RUTEO_E14);
      return { campos, ms: Math.round(performance.now() - t0) };
    }, { dataUrl: fuente.dataUrl });
    const resuelto = await camposResueltos(page, r.campos, consulados);
    const digitosEsperados = { departamento: 2, municipio: 3, zona: 2, puesto: 2, mesa: 3 };
    let okCaso = 0;
    for (const [campo, nd] of Object.entries(digitosEsperados)) {
      const leido = normalizarCampo(r.campos?.[campo]?.valor, nd);
      const esp = normalizarCampo(caso.divipol?.[campo], nd);
      const bien = leido != null && esp != null && leido === esp;
      if (bien) okCaso++;
      total++;
      if (bien) ok++;
    }
    let okCasoRes = 0;
    for (const [campo, nd] of Object.entries(digitosEsperados)) {
      const leidoRes = normalizarCampo(resuelto.ef[campo], nd);
      const esp = normalizarCampo(caso.divipol?.[campo], nd);
      const bienRes = leidoRes != null && esp != null && leidoRes === esp;
      if (bienRes) okCasoRes++;
    }
    totalRes += 5;
    okRes += okCasoRes;
    tabla.push(
      `${caso.imagen}: ${okCaso}/5 crudo · ${okCasoRes}/5 resuelto · ${r.ms} ms${resuelto.motivo ? ` · ${resuelto.motivo}` : ""}`
    );
  }
  await page.close();
  const tasa = total > 0 ? ok / total : 0;
  const tasaRes = totalRes > 0 ? okRes / totalRes : 0;
  console.log("\n===== BASELINE GOLDEN OCR =====");
  for (const fila of tabla) console.log("  " + fila);
  console.log(`  TOTAL (OCR crudo): ${ok}/${total} campos correctos (${(tasa * 100).toFixed(1)}%) · umbral etapa ${(UMBRAL * 100).toFixed(0)}%`);
  console.log(`  TOTAL (ruteo resuelto): ${okRes}/${totalRes} campos correctos (${(tasaRes * 100).toFixed(1)}%)`);
  console.log("===============================");
  // [T0] modo medición: el gate duro exige GOLDEN_STRICT=1 (gate sobre
  // la métrica OCR crudo, semántica T0 intacta; el total resuelto se
  // imprime para la aceptación T12/T13 y se documenta en el worklog)
  if (process.env.GOLDEN_STRICT === "1") {
    expect(tasa, `pass-rate ${(tasa * 100).toFixed(1)}% < umbral ${(UMBRAL * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(UMBRAL);
  } else {
    expect(total).toBeGreaterThan(0);
  }
});
