// ============================================================
// DIGITALIZADOR E-14 — Actas E-14 REALES de ejemplo
// Proceden del repositorio oficial (Jg-Stevan/digielect →
// DOCUMENTACION/ACTAS DE EJEMPLO, PDFs convertidos a JPEG).
// El escáner NO depende de ellas: acepta cualquier documento
// por cámara o galería; estas sirven de muestra real.
// ============================================================

// [COORD C-16] basePath del despliegue (GitHub Pages sirve en /digielect)
import { withBasePath } from "@/lib/env";

export interface ActaReal {
  id: string;
  /** Etiqueta corta para el selector */
  etiqueta: string;
  /** Página del ejemplar (1 o 2) */
  pagina: number;
  url: string;
  miniUrl: string;
}

function acta(
  id: string,
  codigo: string,
  pagina: number,
  archivo: string
): ActaReal {
  return {
    id,
    etiqueta: `Acta ${codigo} · P${pagina}`,
    pagina,
    // [COORD C-16] withBasePath: en Pages las imágenes viven en /digielect/actas/…
    url: withBasePath(`/actas/${archivo}.jpg`),
    miniUrl: withBasePath(`/actas/mini/${archivo}.jpg`),
  };
}

export const ACTAS_REALES: ActaReal[] = [
  acta("a1", "495-010-02", 1, "E14_XXX_X_88_495_010_02_000_X_XXX-1"),
  acta("a2", "495-010-02", 2, "E14_XXX_X_88_495_010_02_000_X_XXX-2"),
  acta("b1", "335-005-02", 1, "E14_XXX_X_88_335_005_02_000_X_XXX-1"),
  acta("b2", "335-005-02", 2, "E14_XXX_X_88_335_005_02_000_X_XXX-2"),
  acta("c1", "335-005-81", 1, "E14_XXX_X_88_335_005_81_000_X_XXX-1"),
  acta("c2", "335-005-81", 2, "E14_XXX_X_88_335_005_81_000_X_XXX-2"),
  acta("d1", "355-003-08", 1, "E14_XXX_X_88_355_003_08_000_X_XXX-1"),
  acta("d2", "355-003-08", 2, "E14_XXX_X_88_355_003_08_000_X_XXX-2"),
];

// ── [T0 · plan-mejora] Corpus golden Kit 399 (El Cairo) ──────────
// Las 4 páginas del corpus de calibración (ver tests/golden/corpus/
// README.md). Solo aparecen en el selector si las JPG fueron subidas
// a public/actas/ — probarActasDisponibles() las sondea en runtime.
const ACTAS_KIT399: ActaReal[] = [
  (() => {
    const a = acta(
      "k1",
      "KIT399 TRANSMISION",
      1,
      "E14_KIT399_88_335_005_02_001_X_TRANSMISION-1",
    );
    a.miniUrl = a.url;
    return a;
  })(),
  (() => {
    const a = acta(
      "k2",
      "KIT399 TRANSMISION",
      2,
      "E14_KIT399_88_335_005_02_001_X_TRANSMISION-2",
    );
    a.miniUrl = a.url;
    return a;
  })(),
  (() => {
    const a = acta(
      "k3",
      "KIT399 DELEGADOS",
      1,
      "E14_KIT399_88_335_005_02_001_X_DELEGADOS-1",
    );
    a.miniUrl = a.url;
    return a;
  })(),
  (() => {
    const a = acta(
      "k4",
      "KIT399 DELEGADOS",
      2,
      "E14_KIT399_88_335_005_02_001_X_DELEGADOS-2",
    );
    a.miniUrl = a.url;
    return a;
  })(),
];

/** Sondea qué actas de ejemplo existen realmente (con timeout corto)
 *  y devuelve la lista disponible. Fallback: las 8 del repo. */
export async function probarActasDisponibles(): Promise<ActaReal[]> {
  const candidatas = [...ACTAS_REALES, ...ACTAS_KIT399];
  const disponibles = await Promise.all(
    candidatas.map(async (a) => {
      const ok = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), 4_000);
        const img = new Image();
        img.onload = () => {
          clearTimeout(t);
          resolve(img.naturalWidth > 0);
        };
        img.onerror = () => {
          clearTimeout(t);
          resolve(false);
        };
        img.src = a.miniUrl;
      });
      return ok ? a : null;
    }),
  );
  const lista = disponibles.filter((a): a is ActaReal => a !== null);
  return lista.length > 0 ? lista : ACTAS_REALES;
}
