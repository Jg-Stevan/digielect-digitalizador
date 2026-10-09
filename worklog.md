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
| T9 | Corpus Kit 399 al repo + baseline completo | ✅ | 11b3f60 | 2025-10-09 |
| T10 | Cablear fuenteFullRes (OCR desde warp full-res) | ✅ | ver worklog (T10) | 2025-10-09 |
| T11 | Banner legible (0/4 → ≥3/4, debug con evidencia) | ✅ | ver worklog (T11) | 2025-10-09 |
| T12 | Rescate anti-transposición por único anagrama | ✅ | ver worklog (T12) | 2025-10-09 |
| T13 | Cierre: umbral 80% o documentación honesta | ✅ | ver worklog (T13) | 2025-10-09 |

## FASE 3 v3 — Actas REALES + diseños Stitch (T14–T17)

> Protocolo: `INSTRUCCIONES-AGENTE-FASE3.md` (upload del dueño).
> Gate de entrada: fase previa CERRADA en main (PR #9 mergeado en
> `3d3add8` — CI verde + deploy Pages; worklog T0–T8 ✅). Rama: `fase-3-actas-reales`.

| Tarea | Descripción | Estado | Commit | Fecha |
|---|---|---|---|---|
| T14 | Regla PERMANENTE en CLAUDE.md + eliminación del acta sintética | ✅ | 08a92ae | 2025-10-10 |
| T15 | Información del acta en las pantallas Stitch (ruteo/kit/pág/tipo) | ✅ | 4c23d73 | 2025-10-10 |
| T16 | E2E del flujo REAL: acta real + información correcta | ✅ | 978f3ce | 2025-10-10 |
| T17 | Pulido + guía de prueba del dueño | ✅ | ver abajo | 2025-10-10 |

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

---
Task ID: T11
Agent: Z.ai Code (GLM)
Task: Banner legible 0/4 → 4/4 en corpus Kit 399 (debug con evidencia)

Work Log:
- Helper de debug __debugBanner() añadido a motor-ocr.ts y expuesto por el gancho golden (perfiles de densidad + runs con aceptada/motivo + OCR de ambas pasadas). Instrumentación de solo lectura.
- EVIDENCIA 1 (debug, umbral vigente): la banda que aceptaba buscarBandaBanner en pág. 1 era el encabezado "NIVELACIÓN DE LA MESA" (y≈0.231, dens 0.884) — NO el banner. El banner real (CÓNSUL/EMBAJADOR / TRANSMISIÓN, y≈0.040–0.058) tiene filas de densidad 0.35–0.55 (letras blancas grandes diluyen el negro) → el umbral de fila 0.55 lo fragmentaba en runs de alto 0.0012 → rechazo. En pág. 2 ni NIVELACIÓN pasaba → banda null. Por eso 0/4.
- EVIDENCIA 2 (runs con umbral 0.25 + franja completa y=0.03–0.135 PSM 6, ambas pasadas): la franja lee TODO el encabezado incluida la banda ("CÓNSUL/EMBAJADOR" en D-1) — tesseract maneja el blanco-sobre-negro en modo bloque, pero PSM 7 sobre la banda recortada devuelve basura (la trata como gráfico en modo línea).
- EVIDENCIA 3 (matriz 14 configs × 4 páginas, bitmap original): franja PSM 3/4/11 golpea 4/4; PSM 7/13 sobre banda recortada 0/4.
- EVIDENCIA 4 (afinado con entrada RECOMPRIMIDA del flujo real, cap 3200 + JPEG 0.95 como el golden): T-1 solo lo lee la franja [0.15,0.045,0.7,0.09] l2200 (PSM 3/4, ambas pasadas); D-1 en esa geometría se cae y lo lee [0.15,0.03,0.7,0.105] l1800.
- FIX implementado en reconocerPistas(): cadena de 2 geometrías × 2 pasadas (normal→cubre banner negro-sobre-blanco de scans; invertida→blanco-sobre-negro de corpus 200 dpi), PSM 3, whitelist con acentos (CÓNSUL/TRANSMISIÓN medidos), validación tipoDesdeBanner() en CADA paso (primera válida gana; ninguna → null. Sin votos forzados — la señal sigue valiendo 0.35 en clasificarEjemplar).
- Verificación: banner 4/4 Kit 399 en el golden (T-1 TRANSMISION · T-2 TRANSMISION · D-1 DELEGADOS · D-2 DELEGADOS) · actas repo: 3 null + 5 lecturas VERDADERAS (02-2 TRANSMISION, 81-1/81-2 y 355-1/355-2 DELEGADOS — sus banners negros-sobre-blanco SON legibles y el tipo coincide con el ejemplar impreso; la nota "allí esperado: null" del plan no anticipaba lecturas correctas, no hay NINGÚN falso positivo: 0 votos contradichos o basura) · lint 0 errores (1 warning preexistente) · tsc limpio · contrato OK (ruteo/escaner no tocados, motor sí) · motor golden 4/4 · golden OCR 13/13 TOTAL 41/60 (68.3%) sin regresión.
- Tiempo OCR zonas+pistas: 1601–4423 ms/acta (antes 244–877). El peor caso (4.4 s) son actas repo SIN banner válido que pagan la cadena completa; presupuesto 5 s sigue en verde pero más justo. Hallazgo documentado.
- Archivos tocados: src/lib/ocr/motor-ocr.ts (bandasCandidatasBanner núcleo de __debugBanner + franja en reconocerPistas; los candidatos densidad quedan como instrumentación), src/lib/ocr/gancho-golden.ts (__debugBanner), worklog.md.

Stage Summary:
- BANNER 4/4 EN KIT 399 (meta ≥3/4 superada) y 0 falsos en las 8 del repo. La causa raíz NO era la ventana/umbral que hipotetizaba la tarjeta: era que PSM 7 sobre la banda recortada nunca lee (tesseract la trata como gráfico) y el umbral de densidad 0.55 fragmentaba la banda real. La franja superior con PSM 3 + validación tipoDesdeBanner lo resuelve con fail-soft intacto.
- Archivos: motor-ocr.ts, gancho-golden.ts, worklog.md. Evidencia: golden banner 4/4 + tablas arriba.

---
Task ID: T12
Agent: Z.ai Code (GLM)
Task: Rescate anti-transposición por ÚNICO anagrama (mesa y país)

Work Log:
- ruteo-catalogo.ts: nuevo unicoAnagrama(lectura, opciones) — misma longitud, mismo multiconjunto de dígitos, lectura ≠ opción; devuelve la opción SOLO si es ÚNICA (2+ → null, sin rescate). SIN Levenshtein-2 (prohibido por la tarjeta).
- ruteo.ts · país: rescate integrado ANTES del match difuso. EVIDENCIA que forzó el orden: el difuso Levenshtein-1 preexistente ROBA las transposiciones — "533-05-02" matchea con el consulado REAL 535-05-02 (Beirut, levenshtein 1) y el acta iba a OTRO PAÍS. Anagrama+unicidad+código-existente es señal estrictamente más fuerte.
- ruteo.ts · mesa: rescate tras exacto+clasificación (misma semántica mesaPorCatalogo: ×0.9 y motivo trazable).
- BUG CRÍTICO CORREGIDO en el camino (medido): mismoMulticonjunto usaba Uint8Array — el decremento bajo 0 hace wraparound (0-1 → 255) y el chequeo `cuenta[d] < 0` NUNCA dispara → "115"/"120"/"130"/"135"/"140"/"155" parecían anagramas de "533" → unicidad imposible → rescate país MUERTO. Fix: Int16Array (signed). La mesa funcionaba de casualidad (El Cairo tiene 1 sola mesa).
- EVIDENCIA de lecturas con dígito espurio (medido): la zona país lee a veces "5331" y la mesa "1001" (4 dígitos, cruda conf 0) — ambos rescates intentan también la normalización estándar del ruteo (normalizar a 3 dígitos, la MISMA del módulo). El rescate sigue exigiendo anagrama único + código existente verbatim.
- Guard !campoFallido del rescate país RETIRADO (evidencia): las lecturas cruda/conf-0 SON el caso objetivo; la identidad del país ya está blindada por unicidad+existencia; un campo distinto en baja confianza no dice nada del país. Los motivos de rescate ya NO se engullen en la rama "baja confianza" (trazabilidad para el supervisor).
- Harness golden (tests/ocr-golden.spec.mjs): métrica NUEVA "ruteo resuelto" (los campos que la app EFECTIVAMENTE enrutaría: país/zona/puesto/mesa del catálogo verificado cuando hay sugerencia; departamento sigue siendo OCR crudo — campo de control). El TOTAL OCR crudo y el gate GOLDEN_STRICT conservan la semántica T0 (comparabilidad del baseline); el resuelto se imprime siempre.
- Unit checks vía gancho (temporales, eliminados tras medir): municipio "533" → El Cairo "país rescatado por transposición (único anagrama)" ✓ (antes Beirut); mesa "100" → "mesa rescatada por transposición" ✓; mesa "1001" → rescatada ✓; lecturas válidas → motivo null (0 rescates que alteren lecturas válidas) ✓.
- Checks: lint 0 errores (1 warning preexistente) · tsc limpio · test:contrato OK (ruteo.ts tocado — sin /votos|candidat/ fuera de comentarios: se usaron "opciones"/"unicoAnagrama"/"elegido") · golden 13/13.
- NÚMEROS FINALES: TOTAL OCR crudo 41/60 (68.3%, sin cambios — esperado: los rescates operan en ruteo, no en el OCR) · TOTAL RUTEO RESUELTO 46/60 (76.7%) ≥ meta de la tarjeta 45/60 ✓ (+5: país 533→335 ×2 Kit399 + país 533→335 ×1 81-1 + mesa 100→001 ×2). El auditor medía 45/60 esperado con mesa×2+país×2; nuestro ambiente suma el rescate extra de 81-1 y una mesa menos (varianza OCR ±2 campos declarada normal en el plan).
- RESCATES ACTIVADOS EN EL GOLDEN (lista de aceptación, corrida t12e): (1) T-1 país 533→335 — iba a Beirut 535-05-02 por difuso, ahora El Cairo ✓ · (2) D-1 país 533→335 ✓ · (3) 81-1 país 533→335 ✓ · (4) T-2 mesa 100→001 ✓ · (5) 495-2 mesa 100→001 ✓ (la lectura de zonas de esa página varió en esta corrida). 0 rescates sobre lecturas ya válidas (verificado con caso de control: lectura exacta → motivo null).
- Archivos tocados: src/lib/ocr/ruteo-catalogo.ts (unicoAnagrama + fix Int16Array), src/lib/ocr/ruteo.ts (integración país+mesa, orden vs difuso, motivos trazables), tests/ocr-golden.spec.mjs (métrica resuelto), worklog.md.

Stage Summary:
- RESCATE ANTI-TRANSPOSICIÓN ACTIVO: mesa y país se rescatan por único anagrama con unicidad estricta (fail-safe intacto, sin adivinanzas). RUTEO RESUELTO 46/60 = 76.7% (meta tarjeta ≥45/60 CUMPLIDA). BONUS: corregido el misroute preexistente 533→535-Beirut del difuso (el acta iba a OTRO PAÍS).
- Hallazgo para el futuro: Uint8Array-underflow es un patrón de bug peligroso en conteos — revisar otros contadores del repo si existieran (no se encontraron otros con decremento).
- Archivos: ruteo-catalogo.ts, ruteo.ts, tests/ocr-golden.spec.mjs, worklog.md. Evidencia: tabla de rescates arriba + números 41/60 crudo · 46/60 resuelto.

---
Task ID: T13
Agent: Z.ai Code (GLM)
Task: Cierre — umbral 80% o documentación honesta

Work Log:
- Golden final (modo medición, 13/13 passed): TOTAL OCR crudo 41/60 (68.3%) · TOTAL RUTEO RESUELTO 46/60 (76.7%). Ninguno alcanza el umbral 48/60 (80%) → GOLDEN_STRICT=1 NO se activa (decisión honesta: no bajar umbrales ni gatear por debajo de la meta; el CI sigue en modo medición imprimiendo AMBAS tablas).
- Micro-mejora (c) del plan (reconocerZona: B estructural con conf<0.6 → correr C y votar por dígito): implementada y MEDIDA → efecto 0 campos (41/60 crudo · 46/60 resuelto idénticos) con costo extra de OCR en lecturas bajas → REVERTIDA (no se conserva; disciplinado con "cada micro-mejora con su efecto medido").
- Micro-mejoras (a) d15-espacios y (b) alias no→de: NO aplicables al umbral — levantan SEÑALES (barcode15/Ver/Pag), no campos DIVIPOL; el TOTAL de 60 campos no se movería. Documentadas como mejora opcional futura de señales.
- FALSAS ALARMA CORREGIDA: al iniciar la sesión reporté "ci.yml corrupto (branches: ain]" — ERA UN ARTEFACTO DE RENDERIZADO del pipeline de salida (el literal `[m` se procesa como secuencia ANSI y se come). El archivo SIEMPRE tuvo `branches: [main]` (verificado con od -c contra HEAD). Sin cambios en ci.yml.
- FALLOS RESTANTES documentados con su patrón (los 14 campos que faltan para 60/60 resuelto):
  1. departamento (campo de CONTROL, constante 88 en el exterior): mal leído (08/09/05/95) en ~5-6 de los 60 campos de la medición. Por regla de producto NO es clave de ruteo; "rescatarlo" desde la identidad del consulado sería circular para la métrica (el golden cuenta el campo OCR). Se deja como está.
  2. Actas DEGRADADAS 81-2 y 355-1: mun 359/399 + pue 07/00 — impresión genuinamente degradada. Sin rescate posible: 359/399 no tienen anagramas en el catálogo (verificado) y 07/00 vs 08 no son transposiciones → fail-safe correcto (contingencia/supervisor, no adivinar). Este es exactamente el comportamiento de diseño.
  3. Señales Kit 399 (no cuentan en el 60): barcode15 2/4 (espacios internos rompen el run — conservador), Ver/Pag 3/4.
- Definition of Done Fase 2 (checklist del plan; INSTRUCCIONES-AGENTE.md no vive en el repo — es documento externo del operador):
  * [x] Corpus Kit 399 en public/actas/ + tests/golden/corpus/ (12 casos, 0 SKIP)
  * [x] OCR de la app consumiendo warp full-res (T10) con memoria liberada tras extraer
  * [x] Banner 4/4 en Kit 399 y 0 falsos en las 8 del repo (T11 — supera la meta ≥3/4)
  * [x] Rescates por único-anagrama activos con lista verificada (T12)
  * [~] Golden TOTAL documentado: 46/60 resuelto (76.7%) — meta 48/60 NO alcanzada → gate NO activado, fallos documentados (este documento)
  * [x] lint + tsc + contract tests en verde; ninguna línea editada bajo [SYNC]
  * [x] Invariantes intactos: no adivinar (unicidad+consistencia), manual no encoge, offline estricto
  * [x] worklog.md con T9-T13 documentados + tabla antes/después (abajo)
- Checks finales: lint 0 errores (1 warning preexistente escaner.ts:346) · tsc limpio · test:contrato OK · motor golden 4/4 · warp-fullres 1/1 · golden OCR 13/13.
- Archivos tocados: worklog.md (solo documentación; el código queda exactamente como en el commit de T12).

Stage Summary:
- FASE 2 CERRADA con documentación honesta: el gate 80% NO se activa (46/60=76.7% < 48/60). La ruta a 48/60+ pasa por: (1) medir el efecto de OCR full-res real en FOTOS (el golden escanea scans — T10 no cambia sus números por diseño), (2) rescate del campo departamento como control si el producto lo aprueba, (3) mejorar la legibilidad de las degradadas (upstream del escáner).

TABLA ANTES/DESPUÉS (FASE 2):
| Métrica | Antes (T9 baseline) | Después (T13) | Delta |
|---|---|---|---|
| Golden OCR — campos DIVIPOL crudos | 41/60 (68.3%) | 41/60 (68.3%) | = (los rescates operan en ruteo, no en el OCR crudo) |
| Golden — ruteo RESUELTO (métrica nueva T12) | 41/60* | 46/60 (76.7%) | +5 (país ×3, mesa ×2) |
| Banner (Kit 399) | 0/4 ✗ | 4/4 ✓ | +4 |
| Página efectiva (barcode15 O Ver/Pag) | 4/4 | 4/4 | = |
| barcode15 impreso | 2/4 | 2/4 | = |
| Ver/Pag impreso | 3/4 | 3/4 | = |
| KIT footer | 4/4 | 4/4 | = |
| Civ footer | 3/4 | 3/4 | = |
| Misroute país por difuso | posible (533→535-Beirut) | CORREGIDO (anagrama antes del difuso) | seguridad |
| warpFullRes en el flujo real | plumbado muerto (T2 incompleto) | CABLEADO + limpieza de memoria | T2 completado |
| OCR de la app (fuente) | imagen procesada b/n (doble compresión) | warp full-res (1 compresión, sin filtro) | calidad |
(* el resuelto antes de T12 existía implícitamente con los mismos fallos: el difuso podía incluso enrutar MAL)

Stage Summary (cierre Fase 2): ver arriba.

---
Task ID: 10 (push + PR #10 + CI verde)
Agent: Z.ai Code (GLM)
Task: Push de feat/fase-2-t9-t13, PR #10 y verificación de CI

Work Log:
- Push de feat/fase-2-t9-t13 (T9-T13, 7 commits) → PR #10 (https://github.com/Jg-Stevan/digielect-digitalizador/pull/10) con tabla antes/después.
- Token usado por URL efímera en el push; .git/config limpiado (remote sin credenciales, 0 tokens persistidos).
- CI 1er run FALLO en el paso golden OCR: "Execution context was destroyed, most likely because of a navigation" — FLAKY de infraestructura medido: el SW de la PWA recarga la página al activarse y en el runner lento el reload cayó EN MEDIO de un page.evaluate. Las métricas del CI eran IDÉNTICAS a local (41/60 crudo · 46/60 resuelto; 12/13 passed).
- FIX: conReintento() en tests/ocr-golden.spec.mjs — reintento único re-navegando y re-precalentando el worker ante ese error concreto (commit 73039c1).
- CI 2º run VERDE (run 37885230426): lint · tsc · contract · build · motor golden 4/4 · Golden OCR medición 13/13 con banner 4/4 y ambas tablas en el log (41/60 crudo · 46/60 resuelto).
- Nota: la "corrupción ci.yml" reportada al inicio de la sesión era un artefacto de renderizado (el literal "[m" se procesa como ANSI) — el trigger siempre fue `branches: [main]`; sin cambios.

Stage Summary:
- FASE 2 COMPLETA, PUSHED y con CI VERDE en PR #10 (pendiente de merge por el operador). El gate GOLDEN_STRICT queda apagado por decisión honesta (46/60 < 48/60), con la ruta a 80% documentada en T13.
---
Task ID: T14
Agent: Z.ai Code (GLM) — Fase 3 v3
Task: Regla PERMANENTE "SOLO ACTAS REALES · DISEÑO = STITCH" en CLAUDE.md + eliminación del acta sintética (ActaDocumento.tsx) según INSTRUCCIONES-AGENTE-FASE3.md

Work Log:
- Gate de entrada verificado: fase previa cerrada en main (PR #9 mergeado `3d3add8`, CI verde, deploy Pages OK, worklog T0–T8 ✅ + tarjeta "Task 8 push/PR/merge/Pages"). Repo clonado en limpio; baseline reproducido antes de tocar nada.
- CLAUDE.md: añadida al INICIO (tras el título) la sección "🚨 REGLA ABSOLUTA — SOLO ACTAS REALES · DISEÑO = STITCH" con el texto EXACTO del instructivo (3 puntos: prohibido re-dibujar actas, Stitch = única fuente visual, toda IA lee el archivo completo).
- Eliminado `src/components/digitalizador/ActaDocumento.tsx` (231 líneas: encabezado falso REGISTRADURÍA, barcode DIBUJADO con anchos módulo-3, casillas de votos dibujadas, trazo de firma simulado). `rg -n "ActaDocumento" src/` → VACÍO.
- `PantallaExito.tsx`: bloque del documento sintético (~L368-383) REEMPLAZADO por la IMAGEN REAL del pliego (mismo contenedor: marco de esquinas verde scanner-frame + fine-scroll, figure con data-testid="acta-real", img del warp con caption "ACTA ESCANEADA / IMAGEN REAL · DIGITALIZADA", placeholder honesto "— SIN IMAGEN DEL ACTA —" si no hay imagen). Botón "Ver acta digitalizada en pantalla completa" (`btn-ver-acta-digitalizada`) y visor a pantalla completa CONSERVADOS intactos.
- Helpers que solo servían al re-dibujo ELIMINADOS de PantallaExito: `TITULO_ELECCION`, `etiquetaCandidato`, construcción `resultados`/`informativos` (votos — regla de producto: no se leen), `tituloCuerpo`, objeto `datos` (DatosActaDocumento). Locales nuevos: `totalPaginas` (parseado → null, S-11: nunca inventar).
- Checks: `bun run lint` 0 errores (1 warning preexistente en escaner.ts, documentado) · `bun run tsc` limpio · motor golden 4/4 (21.6 s) · golden OCR modo medición TOTAL 27/40 (67.5%) = baseline exacto, SIN REGRESIÓN (dev server 3210 con NEXT_PUBLIC_BASE_PATH=/digielect-digitalizador).
- ANTES/DESPUÉS del bloque reemplazado (descripción para el dueño):
  · ANTES: dentro del marco de esquinas verdes, un "documento" de PAPEL BLANCO dibujado por la app: encabezado "REGISTRADURÍA NACIONAL" inventado, código de barras pintado con barritas div de anchos calculados, "PÁG 01 DE 02" del parser, casillas de votos, tres líneas de "JURADO 1/2/3" con un garabato SVG simulando firmas, y la imagen real APLASTADA en medio del dibujo.
  · DESPUÉS: el mismo marco de esquinas verdes muestra SOLO la IMAGEN REAL del acta escaneada (la que viajó al servidor), con caption "ACTA ESCANEADA · IMAGEN REAL DIGITALIZADA", botón de pantalla completa intacto. Cero elementos dibujados: ningún barcode, casilla ni firma simulados.

Stage Summary:
- Regla del dueño grabada en CLAUDE.md para toda IA futura; acta sintética eliminada sin referencias rotas; app compila; motor 4/4; golden OCR 27/40 sin regresión. Rama: `fase-3-actas-reales`.
- Pendiente T15: cablear ruteo resuelto/kit/página/tipo a los campos de información de las pantallas Stitch + píldora de advertencia de conflicto.

---
Task ID: T15
Agent: Z.ai Code (GLM) — Fase 3 v3
Task: Información LEÍDA del acta en los campos de las pantallas Stitch (revisión/éxito) según INSTRUCCIONES-AGENTE-FASE3.md — huecos a–e

Work Log:
- `src/lib/digitalizador/info-acta.ts` (nuevo): resolverGrupoLeido() — el GRUPO leído por fuente única sin mezclas (identificación determinista código X→índice O(1) → RUTEO RESUELTO del OCR de zonas → VLM), conflictoPuestoActivo() y conflictoMesaEnviada() para las píldoras de advertencia (solo señales deterministas — el VLM no dispara alarmas).
- PantallaExito: PANEL DE INFORMACIÓN con data-testids (info-zona/puesto/mesa/kit/pag/tipo) estilo Stitch (label-caps + data-mono), chip FIRMAS (presencia VLM, el trazo simulado murió con ActaDocumento), chip RUTEO OCR (estado del ruteo resuelto), y píldoras de advertencia aviso-conflicto-puesto / aviso-conflicto-mesa. Fuentes: [hueco a] ZONA/PUESTO/MESA del grupo leído; [hueco b] KIT = footerKit → parseado.info.kit (nunca hardcode); [hueco c] totalPaginas = parseado → senalesLocales.totalPaginasOcr; [hueco d] tipo = parseado → prop → tipoActaOcr → bannerTipo (tercera fuente).
- PantallaRevision: rutaTarjeta y tituloTarjeta del GRUPO LEÍDO primero (la selección solo pinta si nada se leyó), chip KIT extendido al footer impreso, aviso de conflicto en la tarjeta, respaldos Ver/Pag (totalPaginasOcr) y banner.
- store: SenalesLocales.bannerTipo (nuevo campo, la señal banner cruda como tercera fuente del tipo).
- Checks: lint 0 err · tsc · contrato OK · motor 4/4 · golden 27/40 (67.5%) sin regresión.

Stage Summary:
- La información de las pantallas Stitch sale ahora de lo LEÍDO del acta (ruteo resuelto incluido — antes ignorado) con honestidad S-11 ("—") y advertencias visibles en conflictos. Sin tocar contrato/types ni el envío.

---
Task ID: T16
Agent: Z.ai Code (GLM) — Fase 3 v3
Task: E2E del flujo REAL (tests/acta-fiel.spec.mjs) — acta real → pantalla de éxito con imagen real + información correcta

Work Log:
- Diagnóstico empírico (scripts desechables + VLM sobre el pliego real): el código de transmisión impreso es "X 7-23-10-19 X" (7231019 ✓ índice) y el barcode15 impreso del Kit 399 se lee EXACTO a resolución nativa; el flujo de la app NUNCA había llegado a éxito con estas actas (causa profunda, múltiple y encadenada — ver el commit).
- tests/acta-fiel.spec.mjs (nuevo, en el commit 978f3ce con el detalle completo de cada fix): Opción B → El Cairo → input galería (setInputFiles) → pipeline real → éxito → asserts (i) imagen REAL (data URL del warp, NO render), (ii) campos del corpus esperado-ocr.json (mesa 001, zona 05, puesto 02, tipo, PÁG X DE 2, KIT 399), (iii) NEGATIVO (aria-labels del re-dibujo eliminado ausentes), (iv) pantalla completa a full. Screenshots a test-results/.
- Corpus: TRANSMISION-1/-2 usan las JPG REALES del repo (E14_XXX_X_88_335_005_02_*) — MISMO pliego Kit 399 (barcode 710003993010102/202, KIT 399, Civ 797/798, verificado en el baseline T0). DELEGADOS-1/-2: SKIP con causa documentada (las JPG canónicas no las ha subido el dueño — regla: cero actas sintéticas, no se fabrica material). Si se suben, el spec las corre solo.
- Causas raíz arregladas (cableado, SIN recalibrar el motor — zonas/PSM/regex de calibración intactos):
  1. La detección devolvía la BANDA INTERNA del scan (~15% de alto, limitación upstream documentada en el golden) → la app warpeaba una faja sin encabezado ni barcode → nada se leía. Sanidad del quad en aplicarQuadAuto: faja < 30% de un eje ⇒ marco completo.
  2. El quad de la pág. 2 cubre 96×99.8% (página que LLENA el marco) → esPaginaLlena(≥90%): la ORIGINAL (nativa) como fuente del OCR de señales — el preview de 1500 degradaba el barcode15.
  3. LADO_IMPORT 3200→5500 + passthrough SIN re-encode cuando no hay resize: la doble compresión jpeg 0.92→0.95 producía "5335" en MUNICIPIO (medido); con los bytes intactos lee "335".
  4. fuenteZonasOcrGolden (canvas ≤3200 jpeg 0.95, réplica del harness): el OCR de ZONAS consume su punto de operación MEDIDO (27/40) — la nativa desplazaba el punto del ensemble.
  5. Familia barcode unificada en el store: la LÍNEA IMPRESA (d15 exacto, 4/4 en golden) cierra senalesLocales.barcode15 cuando el texto OCR degrade la línea ("7 100059…") — con validación estructural parseBarcode15 previa. Sin esto el envío automático RN-02 jamás disparaba pese a leerse el código EXACTO en la zona dedicada.
  6. Parser d15: puente de UN espacio interno (ruido medido: "71000399301 0202") con guarda de run EXACTAMENTE-15 acotado — jamás reensambla longitudes libres (un "399 71…" de 18 dígitos NO se puentea).
  7. Puerta de ruteo determinista-primero: un acta IDENTIFICADA (O(1) exacta) no se retiene por un campo de ruteo ilegible — el hint no veta a la señal exacta.
  8. ocr-golden.spec.mjs: robustez del harness — el reload del Service Worker (controllerchange) cae en momento no determinístico (0.5-3 s): esperas funcionales en vez de sleep fijo de 1.5 s (la carrera perdía el gancho en export). Sin tocar asserts ni umbrales.
- Verificación CONTRA EL EXPORT ESTÁTICO (mismo patrón del CI: build → serve :4174 → tests): acta-fiel 2/2 ✓ (10 s/caso) · motor 4/4 ✓ · golden 9/9 ✓ TOTAL 27/40 (67.5%) = baseline exacto, SIN REGRESIÓN ✓ · lint 0 err · tsc · contrato OK.
- Hallazgo documentado: en modo dev (Turbopack HMR) el gancho golden fluctúa tras ediciones en caliente — artefacto del watcher, no existe en el export ni en CI.

Stage Summary:
- El flujo REAL de la app llega a la pantalla de éxito con actas reales por PRIMERA VEZ: imagen real + información correcta (mesa/zona/puesto del ruteo resuelto, tipo, PÁG X DE 2, KIT) + envío RN-02 disparado por la señal determinista. 2/4 casos verdes + 2 con causa (material pendiente del dueño) — aceptación T16 cumplida.

---
Task ID: T17
Agent: Z.ai Code (GLM) — Fase 3 v3
Task: Pulido final + GUIA-PRUEBA.md + verificación verde de cierre

Work Log:
- T16 corregido y estable (2/2 verde en re-runs; el fallo de causa conocida del primer intento — la carrera del reload del SW — quedó cerrado con esperas funcionales).
- GUIA-PRUEBA.md (nuevo, raíz, sin jerga, 1 página): abrir la app → Opción B → cargar acta real (galería / PROBAR CON ACTA REAL / cámara) → qué DEBE verse (imagen real + campos) + significado del "—" y de la advertencia de mesa/puesto distinto + prueba rápida con las 2 actas El Cairo incluidas.
- Evidencia para el dueño: docs/evidencia-fase3/ con los screenshots de los 2 casos ejecutados (pantalla de éxito con el visor a pantalla completa mostrando la IMAGEN REAL del acta).
- Verde final contra el export (como CI): lint 0 errores (1 warning preexistente en escaner.ts, documentado desde Fase 2) · tsc limpio · test:contrato OK · motor 4/4 · OCR golden 9/9 con TOTAL 27/40 (67.5%) sin regresión · acta-fiel 2/2 + 2 skip con causa. Nada [SYNC] tocado (verificado con git diff).
- Rama fase-3-actas-reales (basada en main e8d34df) → PR final con tabla antes/después + evidencia. El agente paralelo trabaja Fase 2 en feat/fase-2-t9-t13 (sin solape de archivos con esta rama).

Stage Summary:
- FASE 3 CERRADA: regla absoluta grabada en CLAUDE.md, acta sintética eliminada, información leída en las pantallas Stitch, flujo real E2E verde con actas reales, guía del dueño y evidencia. Listo para prueba del dueño.

