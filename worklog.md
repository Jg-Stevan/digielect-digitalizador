# WORKLOG — Plan mejora detección acta (v1.1)

> Fuente de verdad del estado. Protocolo: `INSTRUCCIONES-AGENTE.md`.
> Repo: `Jg-Stevan/digielect-digitalizador` · rama de trabajo: `feat/plan-deteccion-v2`

| Tarea | Descripción | Estado | Commit | Fecha |
|---|---|---|---|---|
| T0 | Golden harness + corpus + baseline | ✅ | f11fdc4 (spec: tests/ocr-golden.spec.mjs) | 2025-10-09 |
| T1 | Decode 1× bitmap | ✅ | f11fdc4 (motor-ocr.ts) | 2025-10-09 |
| T2 | Reorden + fuente full-res | ✅ | f11fdc4 | 2025-10-09 |
| T3 | Ensemble early-exit | ✅ | f11fdc4 | 2025-10-09 |
| T4 | Señales impresas + cruces | ✅ | f11fdc4 + fix regex | 2025-10-09 |
| T5 | Lente principal + torch | ✅ | f11fdc4 (auto-torch; F-LENS ya existía) | 2025-10-09 |
| T6 | Cajas adaptativas | ✅ | f11fdc4 (motor-ocr.ts · localizarCajaImpresa) | 2025-10-09 |
| T7 | Ruteo por catálogo | ✅ | f11fdc4 (ruteo-catalogo.ts + ruteo.ts) | 2025-10-09 |
| T8 | Hamming-2 + contingencia asistida | ✅ | f11fdc4 | 2025-10-09 |
| T9 | Corpus Kit 399 al repo + baseline completo | ⬜ | — | — |
| T10 | Cablear fuenteFullRes (OCR desde warp full-res) | ✅ | ver worklog (T10) | 2025-10-09 |
| T11 | Banner legible (0/4 → ≥3/4, debug con evidencia) | ⬜ | — | — |
| T12 | Rescate anti-transposición por único anagrama | ⬜ | — | — |
| T13 | Cierre: umbral 80% o documentación honesta | ⬜ | — | — |

Baseline inicial (medido, T0):
```
Golden OCR sobre las 8 actas del repo (scan-completo — las cajas están calibradas
para warp marco-completo y el scan ES el acta completa):
  · Actas limpias (335_005_02, 495_010_02): 9-10/10 campos
  · Actas degradadas (335_005_81, 355_003_08): 2-3/10 campos (→ contingencia, como
    documentaba el plan: "2 de 4 actas de referencia degradadas fallan")
  · TOTAL: 27/40 campos DIVIPOL correctos = 67.5% (umbral etapa 1: 80%)
  · Tiempo OCR zonas+pistas: 660–980 ms por acta (presupuesto 5 s ✓ holgado)
  · Señales impresas verificadas in-page sobre 335_005_02-1 (Kit 399, El Cairo):
      barcode15 impreso = 710003993010102 (EXACTO)
      footer = "No. Form: 399 KIT 399 Civ 797" (EXACTO)
      identificarActa → IDENTIFICADA 0.99 EXACTA → mesa 001 El Cairo (88·335·05·02)
      clasificarEjemplar → TRANSMISION p1 · barcodeFamilia "reforzado" · 0 conflictos
  · Las 4 páginas Kit 399 del corpus quedan en SKIP hasta subir las JPG a
    public/actas/ (nombres en tests/golden/corpus/README.md)
```

Gate duro del golden: `GOLDEN_STRICT=1 bunx playwright test tests/ocr-golden.spec.mjs`
(modo medición por defecto hasta que las mejoras levanten el pass-rate; el golden del
motor preexistente `tests/motor.spec.mjs` pasa 4/4 — sin regresiones).

---
Task ID: T0–T8
Agent: Z.ai Code (GLM)
Task: Implementar completo el plan de mejora de detección del acta E-14 (fases F0–F5 · tarjetas T0–T8) según plan-mejora-deteccion-actas.md v1.1 + INSTRUCCIONES-AGENTE.md

Work Log:
- Sesión anterior (commit b147111): diseños Stitch de Revisión ya implementados y verificados (RN-02/RN-03 + overlay). Commit aparte para separar entregas.
- T0: creado `tests/golden/esperado-ocr.json` (12 casos: 4 Kit399 con barcode/tipo/pág/Civ/anclas + 8 del repo con DIVIPOL; zonasPistas medidas; umbrales por etapa), `tests/golden/corpus/README.md` (nombres canónicos de las JPG), `tests/ocr-golden.spec.mjs` (Playwright, corre el pipeline REAL vía gancho, tabla de pass-rate, gate con GOLDEN_STRICT), gancho `src/lib/ocr/gancho-golden.ts` (window.__digielectOcrGolden, importado por DigitalizadorApp) y telemetría local `src/lib/ocr/telemetria.ts` (IndexedDB store "metricas-batch", export JSON, botón en PantallaControl + window.__digielectExportarTelemetria). Corregido el harness tras depurar: el motor detecta una banda interna en SCANS (limitación upstream conocida) → la fuente fiel es el scan completo (equivale al warp marco-completo); si detecta página completa (foto real) usa el warp como la app.
- T1: `motor-ocr.ts` reescrito — el dataURL se decodifica UNA vez a ImageBitmap y todas las zonas se recortan desde él (antes: 5 decodificaciones; fetch+blob+createImageBitmap por zona). bmp.close() en finally, canvas liberado por zona.
- T2: orden de lectura mesa→puesto→zona→municipio→departamento (`ORDEN_LECTURA_RUTEO` en zonas-e14.ts); `leerSenalesOcr(dataUrl, fuenteFullRes?)` y `extraerSenalesLocales(imagen, fuenteFullRes?)` aceptan la fuente de mayor calidad; recorte del tercio superior ahora PNG (sin doble compresión JPEG).
- T3: ensemble con early-exit por zona: A (tal cual, PSM7) → si no pasa validez estructural → B (contraste p85, PSM7) → C (b/n Bradley adaptativo ×2.5, PSM8); votación por posición de dígito ponderada por confianza; discrepancia → nota "multivariante-discrepan". Tope por zona 1.5 s (early-exit verificado: B/C solo corren si A falla).
- T4: pistas impresas — `ZONAS_PISTAS_E14` (barcodeImpreso [0.20,0.040,0.80,0.018] PSM7 · footer [0,0.93,1,0.07] PSM6) + banner con banda oscura detectada por densidad de píxeles y pasada INVERTIDA; parser puro `src/lib/ocr/senales-impresas.ts` (regex tolerantes medidas: "710003993010102 ve01Pagde2" → d15 exacto; footer perfecto); votos integrados en `clasificarEjemplar` (familia barcode ÚNICA con sub-fuentes decodificado/impreso: coinciden → voto reforzado; discrepan → conflicto y ninguna vota; Ver/Pag 0.35; banner 0.35; Civ 0.3 vía mapa aprendido por kit) + cruce KIT impreso ↔ dígitos 3-8 del barcode. El store alimenta todo desde `reconocerPistas()` y expone `conflictosSenales`.
- Mapa Civ→página por kit: aprendido con página autoritativa (barcode15 válido o envío confirmado), persistido en IndexedDB ("civ-por-kit"), restauración perezosa. NUNCA regla dura.
- T5: torch automático en baja luz en `use-camara.ts` (hysteresis brillo<0.35 enciende / >0.45 apaga solo lo encendido por auto; 2 s de período; try/catch — desktop intacto). La selección de lente principal (F-LENS v4) ya existía del port v6.3.
- T6: `localizarCajaImpresa()` — ventana ±8% alrededor de la caja calibrada, perfiles de densidad de tinta por fila/columna → bordes del rectángulo impreso; sanidad de dimensiones (0.45–2.4×); exactamente 1 caja plausible → recentrar; si no → caja fija (fail-safe).
- T7: `src/lib/ocr/ruteo-catalogo.ts` — clasificarConCatalogo(lectura, candidatos, confianza): score por posición ponderado por confianza por dígito, umbral 0.67 + margen 0.15 sobre el 2º (unicidad). Integrado en `resolverRuteo`: país clasificado ENTRE los países del catálogo y mesa ENTRE las mesas reales del puesto (solo si único plausible; sinonimia con confianza reducida + motivo trazable).
- T8: `identificarActa` con rescate Hamming-2 SOLO si el encabezado DIVIPOL completo deja un ÚNICO candidato consistente (conf 0.55, ruta "HAMMING2"); `candidatosRescate()` top-3 (Hamming-1 por mismatches + Hamming-2 respaldado) para la UI; `PantallaContingencia.tsx` muestra "CANDIDATOS DETECTADOS — CONFIRME CON UN TOQUE" (prellena puesto/mesa; el envío SIEMPRE pasa por TRANSMITIR — 0 auto-envíos).
- Entrega: link de descarga del proyecto fuente (ZIP) en PantallaInicio debajo de "BASE LOCAL DEL DISPOSITIVO" (`/proyecto-fuente-digielect.zip`, conBasePath; zip en public/ no versionado, regenerado al cierre de cada sesión).
- Verificación: `tsc` limpio · `lint` 0 errores (1 warning preexistente en escaner.ts) · golden motor 4/4 · golden OCR baseline 67.5% (tabla arriba) · flujo E2E en navegador (430×880): Inicio → Opción B El Cairo → PROBAR CON ACTA REAL (8 actas; Kit399 ocultas por probe de disponibilidad) → Revisión con banda verde "10/10 ÓPTIMA · ENVIADO CORRECTAMENTE" (RN-02) → pill compacta → pipeline real in-page IDENTIFICADA 0.99 con El Cairo mesa 001.
- Hallazgos (no bloqueantes): (1) el banner "TRANSMISION" de ESTE scan es negro-sobre-blanco (el blanco-sobre-negro es de los PDFs del corpus) — la señal banner queda fail-soft y el tipo lo resuelve la familia barcode; (2) "Ver: 01 Pag: 1 de 2" se imprime tan pequeño que el OCR lo degrada a "ve01Pagde2" — la regex NUNCA inventa el dígito de Pag (sin voto, no adivinar); con las páginas 200dpi del corpus puede leer completo; (3) `GET /api/digitalizador/bootstrap 404` es el modo demo sin backend (cola offline) — comportamiento por diseño.

Stage Summary:
- LAS 9 TARJETAS (T0–T8) IMPLEMENTADAS Y VERIFICADAS. Invariantes intactos: no adivinar (todo rescate exige unicidad+consistencia; conflicto → supervisor), manual no encoge, offline estricto, archivos [SYNC] intocados.
- Archivos tocados: src/lib/ocr/{motor-ocr.ts, zonas-e14.ts, ruteo.ts, ruteo-catalogo.ts (nuevo), senales-impresas.ts (nuevo), telemetria.ts (nuevo), gancho-golden.ts (nuevo)}, src/lib/identificacion-acta.ts, src/lib/scanner/ocr-local.ts, src/lib/digitalizador/{store.ts, use-camara.ts, actas-reales.ts}, src/components/digitalizador/{PantallaRevision.tsx, PantallaContingencia.tsx, PantallaControl.tsx, PantallaCaptura.tsx, PantallaInicio.tsx, DigitalizadorApp.tsx}, tests/ocr-golden.spec.mjs (nuevo), tests/golden/{esperado-ocr.json (nuevo), corpus/README.md (nuevo)}, .gitignore.
- Pendiente (requiere material del usuario): subir las 4 JPG del corpus Kit 399 a public/actas/ + tests/golden/corpus/ con los nombres de tests/golden/corpus/README.md → correr golden en modo GOLDEN_STRICT=1 (aceptación F1.5: 4/4 tipo+página solo con señales impresas).
- Evidencia: baseline 67.5% (27/40) con detalle por acta en la salida de `bunx playwright test tests/ocr-golden.spec.mjs --reporter=list`; pipeline in-page 335_005_02-1 IDENTIFICADA 0.99 + barcode15 exacto + KIT/Civ exactos; motor golden 4/4.

---
Task ID: 8 (push + PR #9 + CI medición + merge + Pages)
Agent: main (Z.ai Code)
Task: Push de feat/plan-deteccion-v2, PR a main, paso CI golden OCR en modo medición, merge y verificación del deploy en GitHub Pages

Work Log:
- ci.yml: nuevo paso "Golden OCR — modo medición (sin GOLDEN_STRICT; tabla en el log)" — sirve el export en :4174 y corre `bunx playwright test tests/ocr-golden.spec.mjs --reporter=list`; la tabla pass-rate por campo queda impresa en el log del run (los Kit 399 sin JPG se saltan; las 8 actas del repo SÍ corren).
- ocr-golden.spec.mjs: test.setTimeout (240 s por caso, 300 s el umbral global) porque los runners de CI son más lentos que local (real local: 13.6 s el umbral, ~4.5 s por acta).
- Validación local previa al push: golden OCR completo en modo medición → TOTAL 27/40 (67.5%), idéntico al baseline; YAML del ci.yml validado.
- Push de feat/plan-deteccion-v2 → PR #9 (https://github.com/Jg-Stevan/digielect-digitalizador/pull/9).
- CI 1er run FALLO en contract test: "ruteo.ts menciona votos/candidaturas fuera de comentarios" — T7 había introducido `candidatasMesa` + motivo "único candidato plausible" (inocuos semánticamente, pero la regla de producto es literal). FIX: renombrado a `mesasDelPuesto` / motivo "única mesa plausible del puesto" (commit 58ee330). El test de contrato NO se tocó (anti-regresión). Nota: test:contrato no se había corrido localmente tras T7 — ahora es parte del chequeo pre-push.
- CI 2º run VERDE (run 37873530096): lint, tsc, contract, build, motor golden 4/4 y Golden OCR medición con tabla en el log → TOTAL 27/40 (67.5%).
- Merge del PR #9 a main (merge commit 3d3add8) · Deploy a GitHub Pages exitoso (run 37873857735).
- Verificación de Pages: https://jg-stevan.github.io/digielect-digitalizador/ → HTTP 200, título correcto, 9 chunks servidos; bundle contiene __digielectOcrGolden (T0), candidatosRescate (T8), "SEGUIR ESCANEANDO", "TRANSMITIR CON ADVERTENCIA", "Revisión requerida", "NO RECONOCIDA", "OBLIGATORIO REPETIR FOTO", "ENVIAR A REVISIÓN HUMANA".
- main local sincronizado a 3d3add8; ZIP de entrega regenerado con git archive (22.4 MB, 193 archivos) en public/ + copia en el sandbox.
- Token de push usado por URL efímera (nunca persistido en .git/config ni archivos; el zip NO contiene .git).

Stage Summary:
- feat/plan-deteccion-v2 MERGEADA a main y DEPLOYADA a Pages con todas las mejoras T0–T8 + Stitch. CI imprimiendo la tabla golden en cada run (modo medición, sin gate).
- PENDIENTE (requiere material del usuario): las 4 JPG de corpus-golden/ → copiarlas a tests/golden/corpus/ + public/actas/ (nombres exactos en tests/golden/corpus/README.md), correr golden completo, reportar tabla post-mejoras vs baseline 67.5%. Si ≥80% → activar GOLDEN_STRICT=1 en el paso de CI. Si no → analizar campos fallando antes de tocar código.


---
Task ID: T9
Agent: Z.ai Code (GLM)
Task: Corpus Kit 399 al repo + baseline completo documentado

Work Log:
- Copiadas las 4 JPG del corpus (nombres canónicos ya correctos) a public/actas/ y tests/golden/corpus/ (~0.9-1.1 MB c/u, 200 dpi, 2412×7234 px).
- Golden OCR en modo medición (dev server :3210 con basePath): 12 casos, 0 SKIP, 13/13 tests passed (1.4 min).
- Golden del motor: 4/4 (sin regresiones).
- NO se arregló nada en esta tarjeta (solo medir y documentar).

Stage Summary:
- Baseline completo REPRODUCE EXACTO la referencia de auditoría (rev. 3d3add8):
```
Golden OCR (12 casos × 5 campos DIVIPOL):
  TOTAL: 41/60 campos correctos (68.3%) · umbral etapa 1 = 80% (48/60) · modo medición
  Kit 399 (200 dpi):   T-1 4/5 · T-2 4/5 · D-1 3/5 · D-2 3/5   (14/20)
  Actas repo limpias:  4/5 · 5/5 · 5/5 · 5/5                  (19/20)
  Actas repo degradadas: 2/5 · 2/5 · 2/5 · 2/5                (8/20)
  Tiempo OCR zonas+pistas: 244–877 ms/acta (presupuesto 5 s ✓)
```
- Señales impresas Kit 399 (objetivo F1.5):
```
KIT footer:  4/4 ✓
Página efectiva (barcode15 O Ver/Pag): 4/4 ✓ (redundancia funciona)
barcode15:   2/4 (exacto cuando lee: 710003993010102 / …2010202)
Civ footer:  3/4 (D-2 no lee Civ)
Banner:      0/4 ✗ (no dispara — tarjeta T11)
Ver/Pag:     3/4 (T-1 no lee pag)
```
- Patrón de fallo DIVIPOL confirmado en ambiente local (transposición de dígitos): mesa 001→100 (D-1), municipio 335→533 (T-2, D-2), departamento 88→08/09 (campo de CONTROL, no clave de ruteo). Tal como medía la auditoría.
- Archivos tocados: public/actas/E14_KIT399_*.jpg (4, nuevos), tests/golden/corpus/E14_KIT399_*.jpg (4, nuevos), worklog.md.
- Evidencia: salida completa del golden en la sesión (13 passed; TOTAL 41/60=68.3%); commit e69f831 (índice fase 2) → este commit.

---
Task ID: T10
Agent: Z.ai Code (GLM)
Task: Cablear fuenteFullRes — OCR y pistas desde el warp full-res (completa el T2 pendiente)

Work Log:
- escaner.ts · dataUrlWarpFullRes(): helper nuevo que codifica el bitmap del warp a dataURL JPEG q0.92 (lado mayor capado a 3200 px) con la MISMA rotación local que el resultado (las zonas calibradas asumen orientación final — decisión documentada: sin esto, rotaciones 90/180/270 romperían el OCR del full-res).
- escaner.ts · procesarPagina(): codifica el warp ANTES de scannerAdapter.realzar (el worker transfiere/neutra el bitmap en el realce — postMessage transfer). El fallback canvas también codifica (desde su bitmap). Retorno: Promise<ResultadoProceso & { warpFullRes?: string }> — intersección LOCAL; src/lib/contrato/types.ts INTACTO.
- types.ts · CapturaActual: warpFullRes?: string | null (efímero, nunca persiste).
- PantallaRevision.tsx: EntradaCache.warpFullRes; los 3 caminos cableados: cache-hit (~258) pasa hit.warpFullRes, preview cache-miss (~268) guarda r.warpFullRes en la entrada y pasa a extraerSenalesLocales con limpieza .then(), prepararYFinalizar (~423) reutiliza el del cache o el nuevo y lo pasa a finalizarCaptura. El 3er llamado literal (~696, "descargar" para exportar PNG) NO consume OCR → no se cablea (no hay receptor; hallazgo documentado).
- store.ts: finalizarCaptura pasa c.warpFullRes a extraerSenalesLocales; limpieza de memoria en finally de extraerSenalesLocales (captura.warpFullRes → null; el guard C-17 evita reruns; nada persistente en IndexedDB). PantallaRevision limpia también su EntradaCache local tras extraer.
- gancho-golden.ts: expone procesarPagina (espejo de solo lectura) + tests/warp-fullres.spec.mjs (evidencia permanente).
- Evidencia A (pipeline real, preview:false): tests/warp-fullres.spec.mjs PASSED → {"tieneWarp":true,"esJpeg":true,"lenBase64":506987,"decodable":true,"wDecod":1045} (JPEG ≤3200 px, decodificable de vuelta).
- Evidencia B (flujo REAL con traza temporal, QUITADA antes del commit): E2E UI Inicio → Opción B (El Cairo 335-05-02) → PROBAR CON ACTA REAL → tarjeta → Revisión → "[T10-TRACE] extraerSenalesLocales fuenteFullRes= 70KB data:image/jpeg;base64,/9j/4AA" — el OCR de la app consume el warp full-res (camino preview, cap CAP_PREVIEW=1500 → ~70 KB; el camino final cap 3200 → ~500 KB, evidenciado en A).
- Checks: lint 0 errores (1 warning preexistente escaner.ts:346) · tsc limpio · test:contrato OK (escaner.ts tocado) · motor golden 4/4 + warp-fullres 1/1 · golden OCR 13/13 SIN regresión (41/60 = 68.3%, idéntico al baseline T9).

Stage Summary:
- El OCR de zonas, el del tercio superior y las pistas impresas del flujo REAL ahora consumen el warp full-res (sin filtro de realce y con UNA sola compresión JPEG). T2 queda completado.
- Hallazgo (preexistente, no tocado por regla de tarjeta): procesarPagina devuelve w:0/h:0 porque liberarCanvas() corre antes de leer canvas.width — los llamadores reciben dims en 0 sin que nada lo consuma hoy (la calidad viene por captura separada). Nota para un futuro fix fuera de esta tarjeta.
- Archivos tocados: src/lib/digitalizador/escaner.ts, src/lib/digitalizador/types.ts, src/lib/digitalizador/store.ts, src/components/digitalizador/PantallaRevision.tsx, src/lib/ocr/gancho-golden.ts, tests/warp-fullres.spec.mjs (nuevo), worklog.md.
- Evidencia: números arriba (A y B) + golden 41/60 sin regresión; commit de este mensaje.
