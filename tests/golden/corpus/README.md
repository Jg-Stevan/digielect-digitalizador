# Corpus golden OCR (plan-mejora T0)

Copiar aquí (y a `public/actas/`) las 4 páginas del Kit 399 (El Cairo)
con ESTOS nombres exactos (ver ../esperado-ocr.json):

- E14_KIT399_88_335_005_02_001_X_TRANSMISION-1.jpg  (barcode 710003993010102, Civ 797)
- E14_KIT399_88_335_005_02_001_X_TRANSMISION-2.jpg  (barcode 710003993010202, Civ 798)
- E14_KIT399_88_335_005_02_001_X_DELEGADOS-1.jpg    (barcode 710003992010102, Civ 797)
- E14_KIT399_88_335_005_02_001_X_DELEGADOS-2.jpg    (barcode 710003992010202, Civ 798)

Mientras las imágenes no existan, tests/ocr-golden.spec.mjs las SALTA.
Las 8 actas del repo (E14_XXX_…) viven en public/actas/ y SÍ corren.
