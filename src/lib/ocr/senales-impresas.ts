// ============================================================
// OCR E-14 — Señales IMPRESAS baratas (plan-mejora F1.5)
// ============================================================
// El acta ya trae impreso lo que hoy se sufre decodificando:
//   · los 15 dígitos bajo el código de barras (+ "Ver: 01 Pag: 1 de 2")
//   · el pie "No. Form: 399 · KIT 399 · Civ 797/798"
//   · el banner del ejemplar (TRANSMISION / CÓNSUL-EMBAJADOR)
// Este módulo es 100% PURO (sin DOM/red): parsea los textos crudos
// del OCR con las regex TOLERANTES medidas sobre el corpus real
// (Kit 399, El Cairo — tests/golden/esperado-ocr.json) y gestiona
// el MAPA APRENDIDO Civ→página por kit (NUNCA regla dura: solo es
// un voto cuando el kit ya fue enseñado con un escaneo confirmado).
// ============================================================

// ------------------------------------------------------------
// 1) Línea del barcode impreso: d15 + Ver/Pag
// ------------------------------------------------------------

export interface SenalesBarcodeImpreso {
  /** 15 dígitos impresos bajo el código de barras */
  d15: string | null;
  /** "Ver: 01" → versión del formato */
  ver: number | null;
  /** "Pag: 1 de 2" */
  pag: number | null;
  de: number | null;
}

/**
 * Regex TOLERANTE a lo que el OCR de verdad produce sobre la línea
 * impresa (medido en corpus real): "Pag: 1 de 2", "Pagit 1 de 2",
 * "Pana 1 de 2", "Pag: tde2" (los separadores se degradan).
 * Estrategia: token "Pa(g|q)"~ + primer dígito + separador de/similar
 * + segundo dígito; fallback "N de M" desnudo en la misma línea.
 */
export function parsearBarcodeImpreso(
  texto: string | null | undefined
): SenalesBarcodeImpreso | null {
  if (!texto) return null;
  const plano = texto.replace(/\s+/g, " ").trim();

  // d15: primer run de 15 dígitos (el normalizador del repo quita
  // espacios; aquí tomamos el run puro — NUNCA reensamblamos trozos).
  let d15 = /\d{15}/.exec(plano.replace(/[^\d]/g, " "))?.[0] ?? null;
  // [T16 · ruido medido] El OCR inserta UN espacio DENTRO del número
  // impreso (medido en la página 2 del Kit 399: "71000399301 0202").
  // Puente de un solo espacio SOLO si el resultado es un run de
  // EXACTAMENTE 15 dígitos acotado (la longitud impresa del barcode):
  // nunca se reensamblan trozos de longitudes libres — un "399 71…"
  // de 18 dígitos NO se puentea (regla no-adivinar intacta).
  if (!d15) {
    const puentado = plano.replace(/(\d) (\d)/g, "$1$2");
    const m = /(?<!\d)\d{15}(?!\d)/.exec(puentado);
    if (m) d15 = m[0];
  }

  // Ver: NN — tolerante al ruido medido ("ve01", "Ver 01", "Ver: 01")
  const ver = /v\W{0,2}e\W{0,2}r?\W{0,3}(\d{1,2})/i.exec(plano)?.[1] ?? null;

  // Pag: N de M (tolerante). LO QUE EL OCR DE VERDAD PRODUCE:
  //  · "Pag: 1 de 2" · "Pag 1 no 2" (de≈no en impresión débil)
  //  · "Pagde2" (el dígito de Pag se pierde — NUNCA se inventa:
  //    sin dígito explícito no hay voto de página por esta vía)
  let pag: string | null = null;
  let de: string | null = null;
  const m1 = /pa[giqtro]{0,3}\W{0,4}(\d)\W{0,4}d[en]\W{0,4}(\d)/i.exec(plano);
  if (m1) {
    pag = m1[1];
    de = m1[2];
  } else {
    const m2 = /(\d)\s*d[en]\s*(\d)/i.exec(plano);
    if (m2) {
      pag = m2[1];
      de = m2[2];
    }
  }

  if (!d15 && !pag && !ver) return null;
  return {
    d15,
    ver: ver != null ? Number.parseInt(ver, 10) : null,
    pag: pag != null ? (Number.parseInt(pag, 10) as 1 | 2) : null,
    de: de != null ? Number.parseInt(de, 10) : null,
  };
}

// ------------------------------------------------------------
// 2) Footer: No. Form / KIT / Civ
// ------------------------------------------------------------

export interface SenalesFooter {
  /** "No. Form: 399" */
  noForm: number | null;
  /** "KIT 399" */
  kit: number | null;
  /** "Civ 797" (página impresa del formulario dentro del kit) */
  civ: number | null;
}

export function parsearFooter(
  texto: string | null | undefined
): SenalesFooter | null {
  if (!texto) return null;
  const noForm = /No\.?\s*Form\W{0,3}(\d{1,6})/i.exec(texto)?.[1] ?? null;
  const kit = /KIT\s*(\d{1,6})/i.exec(texto)?.[1] ?? null;
  const civ = /Ci[vv]\s*(\d{1,6})/i.exec(texto)?.[1] ?? null;
  if (!noForm && !kit && !civ) return null;
  return {
    noForm: noForm != null ? Number.parseInt(noForm, 10) : null,
    kit: kit != null ? Number.parseInt(kit, 10) : null,
    civ: civ != null ? Number.parseInt(civ, 10) : null,
  };
}

// ------------------------------------------------------------
// 3) Banner del ejemplar (pasada OCR invertida)
// ------------------------------------------------------------

/**
 * "TRANSMISION" → TRANSMISION · "CÓNSUL/EMBAJADOR" → DELEGADOS
 * (la variante CÓNSUL/EMBAJADOR ES el ejemplar DELEGADOS del
 * exterior; mismo ancla que votoDeTexto en identificacion-acta).
 */
export function tipoDesdeBanner(
  texto: string | null | undefined
): "TRANSMISION" | "DELEGADOS" | null {
  if (!texto) return null;
  const t = (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const esDelegados =
    /\bDELEGADOS\b/.test(t) ||
    /CONSUL(?!ADO)[^A-Z]{0,4}EMBAJADOR/.test(t) ||
    /\bEMBAJADOR\b/.test(t);
  const esTransmision = /\bTRANSMISION\b/.test(t);
  if (esDelegados && esTransmision) return null; // conflicto: no vota
  if (esDelegados) return "DELEGADOS";
  if (esTransmision) return "TRANSMISION";
  return null;
}

// ------------------------------------------------------------
// 4) Mapa APRENDIDO Civ → página por kit (voto, nunca regla dura)
// ------------------------------------------------------------

/** kit (numérico sin ceros) → { civ → página } */
type MapaCiv = Map<number, Map<number, 1 | 2>>;

let mapaCivPorKit: MapaCiv = new Map();

/** Enseña (o confirma) civ→página para un kit. Se llama con la página
 *  AUTORITATIVA (barcode15 válido o envío confirmado por el operario). */
export function aprenderCivPorKit(
  kit: number | null | undefined,
  civ: number | null | undefined,
  pagina: 1 | 2
): void {
  if (!kit || !civ) return;
  if (pagina !== 1 && pagina !== 2) return;
  let interno = mapaCivPorKit.get(kit);
  if (!interno) {
    interno = new Map();
    mapaCivPorKit.set(kit, interno);
  }
  interno.set(civ, pagina);
}

/** Voto de página por Civ (null si el kit no fue enseñado aún). */
export function civAPagina(
  kit: number | null | undefined,
  civ: number | null | undefined
): 1 | 2 | null {
  if (!kit || !civ) return null;
  return mapaCivPorKit.get(kit)?.get(civ) ?? null;
}

/** Tamaños del mapa (para telemetría/auditoría). */
export function tamMapaCiv(): number {
  return mapaCivPorKit.size;
}

/** Serializa el mapa (persistencia best-effort en IndexedDB). */
export function serializarMapaCiv(): Array<[number, Array<[number, 1 | 2]>]> {
  return Array.from(mapaCivPorKit.entries()).map(([kit, interno]) => [
    kit,
    Array.from(interno.entries()),
  ]);
}

/** Restaura el mapa persistido (al arrancar la PWA). */
export function restaurarMapaCiv(
  filas: Array<[number, Array<[number, 1 | 2]>]> | null | undefined
): void {
  if (!Array.isArray(filas)) return;
  const mapa: MapaCiv = new Map();
  for (const [kit, pares] of filas) {
    if (!Number.isFinite(kit) || !Array.isArray(pares)) continue;
    const interno = new Map<number, 1 | 2>();
    for (const [civ, pag] of pares) {
      if (Number.isFinite(civ) && (pag === 1 || pag === 2)) {
        interno.set(civ as 1 | 2, pag);
      }
    }
    if (interno.size > 0) mapa.set(kit as number, interno);
  }
  mapaCivPorKit = mapa;
}
