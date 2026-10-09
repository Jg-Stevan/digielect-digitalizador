// ============================================================
// [FASE-3 · T15] INFORMACIÓN LEÍDA DEL ACTA REAL
// ============================================================
// Resuelve el GRUPO de datos de ruteo (zona/puesto/mesa) tal como
// fueron LEÍDOS del acta escaneada, para pintarlo en los campos de
// información de las pantallas Stitch (revisión/éxito):
//   1. Identificación determinista (código X → índice O(1)) — la
//      señal más fuerte: exacta contra la base real del proyecto.
//   2. Ruteo resuelto del OCR de zonas (resolverRuteo contra el
//      catálogo local) — antes ignorado por las pantallas (hueco a).
//   3. Análisis VLM (respaldo — puede equivocarse).
// La selección del puesto activo NO participa: es presentación de
// respaldo que cada pantalla aplica por su cuenta (y NUNCA se mezcla
// con lo leído en una misma fila de campos).
// Regla S-11 (honestidad): lo no leído llega null → la UI muestra
// "—". JAMÁS se inventan valores ni se mezclan fuentes.
// ============================================================

import type { ConsuladoDTO, OcrRuteo } from "@/lib/contrato/types";
import type { SenalesLocales } from "./store";
import type { AnalisisVLM } from "./types";

export interface GrupoLeido {
  zona: string | null;
  puesto: string | null;
  mesa: string | null;
  /** Código del consulado leído ("335-05-02") — para el aviso de
   *  conflicto leído vs seleccionado. null si la fuente no lo trae. */
  codigo: string | null;
  /** Id del consulado leído (si se pudo resolver contra el catálogo) */
  consuladoId: string | null;
  /** true → viene de señal determinista (identificación/ruteo), no VLM */
  determinista: boolean;
}

/** Solo dígitos (normalización de mesa/puesto/zona leídos). */
function digitos(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D+/g, "");
  return d || null;
}

/**
 * Resuelve el ruteo resuelto (resolverRuteo ya corrió en la revisión):
 * mesaIdSugerido → consulado + mesa REALES del catálogo local.
 */
export function ruteoResueltoDe(
  ocrRuteo: OcrRuteo | null,
  consulados: ConsuladoDTO[],
): { consulado: ConsuladoDTO; zona: string | null; puesto: string | null; mesa: string | null } | null {
  const mesaId = ocrRuteo?.mesaIdSugerido ?? null;
  if (!mesaId) return null;
  const c = consulados.find((cc) => cc.mesas.some((m) => m.id === mesaId)) ?? null;
  const m = c?.mesas.find((mm) => mm.id === mesaId) ?? null;
  if (!c || !m) return null;
  return {
    consulado: c,
    zona: c.zona?.trim() ?? null,
    puesto: c.puesto.match(/^(\d+)/)?.[1] ?? null,
    mesa: digitos(String(m.numero)),
  };
}

/**
 * GRUPO leído del acta (una sola fuente gana, sin mezclas):
 * identificación (ubic) > ruteo resuelto > VLM. null si nada se leyó.
 */
export function resolverGrupoLeido(args: {
  senalesLocales: SenalesLocales;
  ocrRuteo: OcrRuteo | null;
  analisis: AnalisisVLM | null;
  consulados: ConsuladoDTO[];
}): GrupoLeido | null {
  const { senalesLocales, ocrRuteo, analisis, consulados } = args;

  // 1) Identificación determinista: ubicación del código X (índice).
  const ubic = senalesLocales.ubicacion;
  if (ubic) {
    const partes = ubic.consulado.split("·"); // "DIVIPOL 88·335·05·02"
    const codigo =
      partes.length >= 4 ? `${partes[1]}-${partes[2]}-${partes[3]}` : null;
    return {
      zona: partes[2]?.trim() ?? null,
      puesto: partes[3]?.trim() ?? null,
      mesa: digitos(String(ubic.mesa ?? "")),
      codigo,
      consuladoId: ubic.consuladoId ?? null,
      determinista: true,
    };
  }

  // 2) Ruteo resuelto del OCR de zonas (validado contra el catálogo).
  const rr = ruteoResueltoDe(ocrRuteo, consulados);
  if (rr) {
    return {
      zona: rr.zona,
      puesto: rr.puesto,
      mesa: rr.mesa,
      codigo: rr.consulado.codigo ?? null,
      consuladoId: rr.consulado.id ?? null,
      determinista: true,
    };
  }

  // 3) VLM (respaldo — no determinista).
  const d = analisis?.divipol;
  if (d && (d.zona || d.puesto || d.mesa)) {
    return {
      zona: d.zona?.trim() ?? null,
      puesto: d.puesto?.trim() ?? null,
      mesa: digitos(d.mesa),
      codigo: null,
      consuladoId: null,
      determinista: false,
    };
  }

  return null;
}

/**
 * [T15 · huecos a+e] Conflicto entre lo LEÍDO (determinista) y el
 * consulado ACTIVO (selección del operario / auto-asignación).
 * Solo señales deterministas (identificación / ruteo resuelto) — el
 * VLM es asesor y no debe disparar alarmas por sí solo.
 */
export function conflictoPuestoActivo(
  leido: GrupoLeido | null,
  puestoActivo: { codigo?: string | null } | null,
): { leido: string; seleccionado: string } | null {
  if (!leido?.codigo || !leido.determinista) return null;
  const seleccionado = puestoActivo?.codigo?.trim() ?? null;
  if (!seleccionado || leido.codigo === seleccionado) return null;
  return { leido: leido.codigo, seleccionado };
}

/**
 * [T15 · hueco a] Conflicto de MESA: la mesa LEÍDA (determinista)
 * difiere de la mesa por la que el acta fue enviada (objetivo
 * dirigido / asignación). Comparación numérica ("01" == "001").
 */
export function conflictoMesaEnviada(
  leido: GrupoLeido | null,
  mesaEnviada: string | null,
): { leido: string; seleccionado: string } | null {
  if (!leido?.mesa || !leido.determinista || !mesaEnviada) return null;
  const nLeido = Number(leido.mesa);
  const nSel = Number(mesaEnviada.replace(/\D+/g, ""));
  if (!Number.isFinite(nLeido) || !Number.isFinite(nSel)) return null;
  if (nLeido === nSel) return null;
  return { leido: String(nLeido), seleccionado: String(nSel) };
}
