# Digitalizador E-14 (PWA del jurado)

## REGLA DE PRODUCTO (no preguntar de nuevo)
LOS VOTOS (CAMPOS MANUSCRITOS) NO SE LEEN Y NO INTERESAN POR EL MOMENTO.
No OCRizar manuscritos. Meta: escanear en alta calidad, extraer con precisión
los datos IMPRESOS de ruteo (depto, municipio, zona, puesto, mesa), ubicar
el acta en el lugar correcto y guardarla. Lo dudoso → contingencia (supervisor).

## Mapa del módulo
- src/components/digitalizador/  → pantallas (captura, revisión, control, resumen…)
- src/lib/digitalizador/         → escaner.ts (API pública), store.ts (Zustand), feedback
- src/lib/scanner-adapter.ts     → puente con el worker de visión
- src/lib/ocr/                   → OCR por zonas (SOLO campos impresos)
- src/lib/contrato/              → [SYNC] tipos/API desde digielect (NO editar a mano)
- src/lib/scanner-core/          → [SYNC] cliente del motor desde web-scanner (NO editar)
- public/scanner/ public/vendor/ public/ocr/ → [SYNC] assets (NO editar)

## Protocolo del worker (verificado — no "corregirlo")
detect|warp|enhance|config → result|warped|enhanced|busy|boot|ready|error
Correlación por `ts`. error usa `message`. corners = Float32Array(8) fracciones 0–1
(TL,TR,BR,BL). detect exige ImageBitmap. Esperar `ready`. busy = descartar intento.

## Invariantes
- manual:true NUNCA encoge 3.5 px (código de barras y firmas).
- Quad SIEMPRE en fracciones 0–1.
- Offline estricto: cero CDNs; opencv-4.5.5.js (nombre exacto), tesseract y worker locales.
- withBasePath() en TODO asset/worker. Liberar canvas tras usar (width=0;height=0).
- El OCR del dispositivo es un HINT: el servidor valida contra el catálogo.
- No modificar web-scanner ni digielect desde este repo (upstreams).

## Comandos
bun run sync:scanner        # actualiza el motor (SHA fijado en motor.ref) + informe novedades
bun run sync:contrato       # actualiza tipos/API desde digielect
bun run test:contrato       # contract test rápido
