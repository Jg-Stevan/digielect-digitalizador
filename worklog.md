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
