// ============================================================
// OCR DE RUTEO E-14 — Ruteo contra el catálogo local
// ============================================================
// Normaliza los valores leídos, resuelve el consulado por codigo
// "{pais}-{zona}-{puesto}" y la mesa por número, y produce la
// sugerencia OcrRuteo (HINT: el servidor valida — Invariante del
// flujo). Match exacto → mesaIdSugerido; distancia ≤1 (Levenshtein
// sobre el codigo) → sugerido con confianza reducida; sin match →
// null + motivo.
// ============================================================

import type { CampoOcr, ConsuladoDTO, OcrRuteo } from "@/lib/contrato/types";
import { clasificarConCatalogo, unicoAnagrama } from "./ruteo-catalogo";
import { ZONAS_RUTEO_E14 } from "./zonas-e14";

/** Solo dígitos. */
function soloDigitos(v: string): string {
  return (v ?? "").replace(/\D+/g, "");
}

/** Normaliza al formato del catálogo (ceros a la izquierda). */
function normalizar(v: string, digitos: number): string {
  const d = soloDigitos(v);
  if (!d) return "";
  return d.slice(0, digitos).padStart(digitos, "0");
}

/** Distancia de Levenshtein (clásica, dos filas). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export interface ResultadoRuteo extends OcrRuteo {
  /** Motivo humano cuando no hay sugerencia (para el feedback). */
  motivo: string | null;
  /** Campo que falló (para el diálogo específico del jurado). */
  campoFallido: string | null;
}

/**
 * Resuelve el ruteo a partir de los campos OCR + el catálogo local
 * (consulados cacheados por el store). "departamento" (CONSULADO 88,
 * constante en el exterior) se lee como control y NO participa del
 * match — la clave es pais-zona-puesto + mesa.
 */
export function resolverRuteo(
  campos: Record<string, CampoOcr | null>,
  consulados: ConsuladoDTO[]
): ResultadoRuteo {
  const campo = (id: string): CampoOcr | null => campos[id] ?? null;

  /**
   * Un campo es ACEPTABLE si:
   *  · conf ≥ confMinima (tesseract confiado), O
   *  · el valor es estructuralmente válido (dígitos exactos — la
   *    medición con actas reales muestra que la confidence de
   *    tesseract v5 sobre impresión degradada es baja incluso en
   *    lecturas CORRECTAS, así que la validez estructural + el
   *    match contra el catálogo son la señal operativa).
   * La combinación completa se valida contra el catálogo: un dígito
   * mal leído rompe el match (950 puestos) → contingencia. Fail-safe.
   */
  const aceptable = (id: string): boolean => {
    const c = campo(id);
    const z = ZONAS_RUTEO_E14.find((zz) => zz.id === id);
    if (!c || !c.valor || !z) return false;
    if (c.confianza >= z.confMinima) return true;
    // validez estructural: SOLO dígitos y cantidad exacta
    const d = c.valor.replace(/\D+/g, "");
    return d.length === z.digitos && d === c.valor;
  };

  const baja = (id: string): boolean => !aceptable(id);

  // Campo fallido para el diálogo (prioridad: mesa > puesto > zona > país)
  const ordenFeedback: Array<"mesa" | "puesto" | "zona" | "municipio" | "departamento"> = [
    "mesa",
    "puesto",
    "zona",
    "municipio",
    "departamento",
  ];
  const campoFallido = ordenFeedback.find((id) => baja(id)) ?? null;

  // Normalizar claves de match
  const pais = normalizar(campo("municipio")?.valor ?? "", 3);
  const zona = normalizar(campo("zona")?.valor ?? "", 2);
  const puesto = normalizar(campo("puesto")?.valor ?? "", 2);
  const mesaNum = soloDigitos(campo("mesa")?.valor ?? "").replace(/^0+(?=\d)/, "");
  const mesaN = Number.parseInt(mesaNum || "0", 10);
  /** [T7] Nota de trazabilidad cuando el país fue clasificado por catálogo */
  let notasPais: string | null = null;

  const confianzas = (["departamento", "municipio", "zona", "puesto", "mesa"] as const)
    .map((id) => campo(id)?.confianza ?? 0)
    .filter((c) => c > 0);
  const confianzaGlobal =
    confianzas.length > 0 ? confianzas.reduce((a, b) => a + b, 0) / confianzas.length : 0;

  const base = (): ResultadoRuteo => ({
    mesaIdSugerido: null,
    confianzaGlobal,
    campos: {
      departamento: campo("departamento"),
      municipio: campo("municipio"),
      zona: campo("zona"),
      puesto: campo("puesto"),
      mesa: campo("mesa"),
    },
    motivo: null,
    campoFallido: null,
  });

  // ¿Claves completas? Si falta algo → sin sugerencia (motivo específico)
  if (!pais || !zona || !puesto || !mesaN) {
    const r = base();
    r.campoFallido = campoFallido;
    r.motivo = campoFallido
      ? `No se pudo leer ${ZONAS_RUTEO_E14.find((zz) => zz.id === campoFallido)?.label ?? campoFallido}`
      : "Campos de ruteo incompletos";
    return r;
  }

  const codigoExacto = `${pais}-${zona}-${puesto}`;

  // 1) Match exacto del consulado
  let consulado = consulados.find((c) => c.codigo === codigoExacto) ?? null;
  let difusa = false;

  // [T7 · plan F4] RUTEO GUIADO POR CATÁLOGO — país clasificado ENTRE
  // los países del catálogo (no OCR libre + match). Solo se usa si NO
  // hubo match exacto/difuso del código completo y el resto de las
  // claves (zona/puesto) son estructuralmente aceptables: un país mal
  // leído con zona/puesto bien leídos NO debe caer a contingencia si
  // existe un ÚNICO país plausiblemente mejor en el catálogo.
  if (!consulado && !campoFallido) {
    const paisesCatalogo = Array.from(
      new Set(consulados.map((c) => String(c.codigo ?? "").split("-")[0])),
    ).filter((p) => /^\d{3}$/.test(p));
    const clasifPais = clasificarConCatalogo(
      campo("municipio")?.valor ?? "",
      paisesCatalogo,
      campo("municipio")?.confianza ?? 0,
    );
    if (clasifPais.elegido) {
      const codigoConPais = `${clasifPais.elegido}-${zona}-${puesto}`;
      const c2 = consulados.find((c) => c.codigo === codigoConPais) ?? null;
      if (c2) {
        consulado = c2;
        difusa = true;
        notasPais = `país clasificado por catálogo (${clasifPais.elegido}, score ${clasifPais.score.toFixed(2)})`;
      }
    }
  }

  // [T12] Rescate anti-transposición del PAÍS — corre ANTES del difuso:
  // EVIDENCIA (golden T12): el match difuso Levenshtein-1 sobre el
  // código completo ROBA las transposiciones y enruta MAL — "533-05-02"
  // matchea con el consulado REAL 535-05-02 (levenshtein 1) y el acta
  // iría a otro país. El anagrama + UNICIDAD es señal estrictamente
  // más fuerte (los anagramas de 533 medidos en el catálogo real: solo
  // 335) y exige que el código armado EXISTA verbatim. Se usa SOLO
  // para armar el código y verificarlo — nunca inventa dígitos.
  // SIN guard de campoFallido: las lecturas con dígito espurio (cruda,
  // conf 0) son EXACTAMENTE el caso objetivo del rescate, y la lectura
  // del país ya está blindada por unicoAnagrama (misma longitud +
  // multiconjunto + unicidad + código existente). Un campo distinto en
  // baja confianza (p.ej. mesa) no dice nada sobre la identidad del
  // país.
  if (!consulado) {
    const paisesCatalogo = Array.from(
      new Set(consulados.map((c) => String(c.codigo ?? "").split("-")[0])),
    ).filter((p) => /^\d{3}$/.test(p));
    // EVIDENCIA (medido): como en la mesa, la zona país (calibrada a 3
    // dígitos) lee a veces "5331" — un dígito espurio; se intenta
    // también con la normalización estándar del ruteo (normalizar a 3
    // dígitos). El rescate sigue exigiendo anagrama único + código
    // existente — nunca altera lecturas válidas ni inventa dígitos.
    const paisCrudo = campo("municipio")?.valor ?? "";
    const anagramaPais =
      unicoAnagrama(paisCrudo, paisesCatalogo) ??
      unicoAnagrama(normalizar(paisCrudo, 3), paisesCatalogo);
    if (anagramaPais) {
      const codigoConPais = `${anagramaPais}-${zona}-${puesto}`;
      const c2 = consulados.find((c) => c.codigo === codigoConPais) ?? null;
      if (c2) {
        consulado = c2;
        difusa = true;
        notasPais = "país rescatado por transposición (único anagrama)";
      }
    }
  }

  // 2) Match difuso (Levenshtein ≤ 1 sobre el codigo completo)
  if (!consulado) {
    for (const c of consulados) {
      if (levenshtein(c.codigo, codigoExacto) <= 1) {
        consulado = c;
        difusa = true;
        break;
      }
    }
  }

  if (!consulado) {
    const r = base();
    r.motivo = `Puesto ${codigoExacto} no existe en el catálogo`;
    r.campoFallido = campoFallido;
    return r;
  }

  // 3) Mesa EXACTA por número… o [T7] clasificada ENTRE las mesas
  //    REALES del puesto detectado (único candidato plausible).
  //    (Nunca difusa ciega: una mesa equivocada enruta el acta a la
  //    tabla equivocada — por eso exige unicidad + margen.)
  let mesa = consulado.mesas.find((m) => m.numero === mesaN) ?? null;
  let mesaPorCatalogo = false;
  let mesaPorAnagrama = false;
  if (!mesa) {
    const digitosMesa = soloDigitos(campo("mesa")?.valor ?? "");
    if (digitosMesa) {
      const mesasDelPuesto = consulado.mesas.map((m) => String(m.numero).padStart(3, "0"));
      const clasifMesa = clasificarConCatalogo(
        digitosMesa,
        mesasDelPuesto,
        campo("mesa")?.confianza ?? 0,
      );
      if (clasifMesa.elegido) {
        const numero = Number.parseInt(clasifMesa.elegido, 10);
        const m2 = consulado.mesas.find((mm) => mm.numero === numero) ?? null;
        if (m2) {
          mesa = m2;
          mesaPorCatalogo = true;
        }
      }
      // [T12] Rescate anti-transposición de la MESA: ÚNICA mesa
      // anagrama del puesto (p.ej. 100→001 cuando el puesto tiene una
      // sola mesa). Misma semántica conservadora de mesaPorCatalogo:
      // confianza ×0.9 y motivo trazable. Si hay 2+ mesas anagrama →
      // sin rescate (unicoAnagrama devuelve null).
      // EVIDENCIA (medido): la zona mesa (calibrada a 3 dígitos) lee
      // a veces "1001" — un dígito espurio; se intenta también con la
      // normalización estándar del ruteo (normalizar a 3 dígitos, la
      // MISMA que el resto del módulo). El rescate sigue exigiendo
      // anagrama único contra mesas reales — nunca altera lecturas
      // válidas ni inventa dígitos.
      if (!mesa) {
        const mesaNorm = normalizar(digitosMesa, 3);
        const anagramaMesa =
          unicoAnagrama(digitosMesa, mesasDelPuesto) ??
          unicoAnagrama(mesaNorm, mesasDelPuesto);
        if (anagramaMesa) {
          const numero = Number.parseInt(anagramaMesa, 10);
          const m2 = consulado.mesas.find((mm) => mm.numero === numero) ?? null;
          if (m2) {
            mesa = m2;
            mesaPorCatalogo = true;
            mesaPorAnagrama = true;
          }
        }
      }
    }
  }
  if (!mesa) {
    const r = base();
    r.motivo = `Mesa ${mesaN} no existe en ${consulado.ciudad} (${consulado.numMesas} mesas)`;
    r.campoFallido = "mesa";
    return r;
  }

  // 4) Baja confianza en algún campo → sugerencia CON aviso.
  //    [T12] los motivos de rescate NO se engullen aquí: si hubo
  //    rescate (mesa anagrama / país anagrama) es la información
  //    trazable más importante para el supervisor.
  if (campoFallido) {
    const r = base();
    r.mesaIdSugerido = mesa.id;
    const motivos: string[] = [];
    if (mesaPorAnagrama) {
      motivos.push("mesa rescatada por transposición (única mesa anagrama del puesto)");
      r.confianzaGlobal = r.confianzaGlobal * 0.9;
    }
    if (notasPais) motivos.push(notasPais);
    r.motivo =
      motivos.length > 0
        ? `${motivos.join(", ")} (campo ${campoFallido} con baja confianza)`
        : "Algún campo se leyó con baja confianza";
    r.campoFallido = campoFallido;
    return r;
  }

  const r = base();
  r.mesaIdSugerido = mesa.id;
  if (mesaPorCatalogo) {
    r.confianzaGlobal = confianzaGlobal * 0.9;
    r.motivo = mesaPorAnagrama
      ? "Mesa rescatada por transposición (única mesa anagrama del puesto)"
      : "Mesa clasificada por catálogo (única mesa plausible del puesto)";
    return r;
  }
  r.confianzaGlobal = difusa ? confianzaGlobal * 0.75 : confianzaGlobal;
  r.motivo = difusa ? (notasPais ?? "Match por distancia 1") : notasPais;
  return r;
}
