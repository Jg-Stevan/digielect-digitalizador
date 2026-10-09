"use client";

// ============================================================
// DIGITALIZADOR E-14 — REVISIÓN DE ACTA (resultado del envío)
// Réplica EXACTA del diseño Stitch: header brand "REVISIÓN DE
// ACTA / E-14", píldora de estado "✓ 9.8/10 ÓPTIMA · ENVIADO
// CORRECTAMENTE", [SOLO ACTAS REALES — CLAUDE.md · REGLA
// ABSOLUTA] la IMAGEN REAL del pliego digitalizado (warp del flujo
// real) dentro del marco de esquinas verde — NUNCA un re-dibujo
// del acta — y CTA "SEGUIR ESCANEANDO" con glow.
// [RN-02 · FLUJO DIRECTO] Con score ≥9 y código leído, el envío
// fue AUTOMÁTICO: esta pantalla confirma el resultado y devuelve
// al escaneo — la contingencia manual no participa.
// ============================================================

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Clock,
  Cloud,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  bandaDeScore,
  BANDA_ESTILO,
  fechaBogota,
  parseBarcode15,
} from "@/lib/digitalizador/reglas";
import type { Banda } from "@/lib/digitalizador/types";
import { useDigitalizador } from "@/lib/digitalizador/store";
import {
  conflictoMesaEnviada,
  conflictoPuestoActivo,
  resolverGrupoLeido,
} from "@/lib/digitalizador/info-acta";

/** Campo del panel de información (mono, valor honesto "—" S-11). */
function InfoCampo({
  testid,
  label,
  valor,
}: {
  testid: string;
  label: string;
  valor: string | number | null | undefined;
}) {
  const texto =
    valor != null && String(valor).trim() !== "" ? String(valor) : "—";
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[8px] font-bold uppercase tracking-widest text-zinc-500">
        {label}
      </dt>
      <dd data-testid={testid} className="data-mono truncate text-[13px] font-bold text-white">
        {texto}
      </dd>
    </div>
  );
}

export default function PantallaExito() {
  const ultimoEnvio = useDigitalizador((s) => s.ultimoEnvio);
  const nuevaCaptura = useDigitalizador((s) => s.nuevaCaptura);
  const analisis = useDigitalizador((s) => s.analisis);
  const senalesLocales = useDigitalizador((s) => s.senalesLocales);
  const captura = useDigitalizador((s) => s.captura);
  const edicion = useDigitalizador((s) => s.edicion);
  const puestoActivo = useDigitalizador((s) => s.puestoActivo);
  const consulados = useDigitalizador((s) => s.consulados);
  const contexto = useDigitalizador((s) => s.contexto);
  const siguienteObjetivo = useDigitalizador((s) => s.siguienteObjetivo);
  // [T15] Ruteo resuelto del OCR de zonas (resolverRuteo corrió en la
  // revisión): valores + estado + motivo de lo LEÍDO del encabezado.
  const ocrRuteo = useDigitalizador((s) => s.ocrRuteo);

  // [PANTALLA COMPLETA] visor del acta DIGITALIZADA (la imagen real
  // escaneada y procesada — recorte + B/N — que viajó al servidor).
  const [verActa, setVerActa] = useState(false);
  const imagenActa = captura?.imagenDataUrl ?? edicion?.original ?? null;

  useEffect(() => {
    if (!ultimoEnvio) nuevaCaptura();
  }, [ultimoEnvio, nuevaCaptura]);

  if (!ultimoEnvio) return null;

  const { estado, motivo, advertencia, mesa, tipoEjemplar, pagina, hora } = ultimoEnvio;
  const esValidado = estado === "VALIDADO";
  // [C-17] encolada offline: estado ámbar (no es rechazo)
  const esEnCola = estado === "EN_COLA" || estado === "OFFLINE";
  const esAnomalia = estado === "ANOMALIA";
  const esRechazado = !esValidado && !esEnCola && !esAnomalia;

  // ----------------------------------------------------------
  // Score para la píldora (mockup: "9.8/10 ÓPTIMA"): el decimal
  // refinado 0-100/10 cuando está disponible; RN-02 decide por el
  // entero (CONVENIOS §4) — el decimal es SOLO presentación.
  // ----------------------------------------------------------
  const scoreEntero = captura?.score ?? 0;
  const scoreDecimal =
    edicion?.calidad != null ? Number((edicion.calidad.score / 10).toFixed(1)) : null;
  const scoreVisual = scoreDecimal ?? scoreEntero;
  const banda: Banda = bandaDeScore(scoreEntero);
  const estilo = BANDA_ESTILO[banda];

  const estadoLabel = esValidado
    ? "ENVIADO CORRECTAMENTE"
    : esEnCola
      ? "GUARDADA EN COLA OFFLINE"
      : esAnomalia
        ? advertencia
          ? "ENVIADA CON ADVERTENCIA"
          : "ENVIADA PARA AUDITORÍA"
        : "ENVÍO RECHAZADO — REPETIR";

  // ----------------------------------------------------------
  // [T15] Información LEÍDA del acta real: prioridad por señal de
  // lectura — identificación determinista (código X → índice O(1))
  // → RUTEO RESUELTO del OCR de zonas (resolverRuteo contra el
  // catálogo — antes ignorado: hueco a) → VLM → puesto activo
  // seleccionado (último recurso de presentación). Grupo completo
  // por fuente: JAMÁS se mezclan valores de fuentes distintas en
  // una misma fila. Lo no leído se muestra "—" (S-11). Nunca inventar.
  // ----------------------------------------------------------
  const barcodeBruto = senalesLocales.barcode15 ?? analisis?.barcode ?? null;
  const parseado = parseBarcode15(barcodeBruto);

  const leido = resolverGrupoLeido({
    senalesLocales,
    ocrRuteo,
    analisis,
    consulados,
  });

  const consulado =
    consulados.find((c) => c.id === leido?.consuladoId) ??
    (leido?.codigo ? consulados.find((c) => c.codigo === leido.codigo) : null) ??
    consulados.find((c) => c.id === puestoActivo?.consuladoId) ??
    null;

  const mesaNumero =
    leido?.mesa ??
    (mesa ? mesa.replace(/\D/g, "") : null) ??
    analisis?.divipol?.mesa ??
    // [ACOPLE] Captura dirigida sin OCR: la mesa del objetivo dirigido
    // (contexto) también es fuente legítima del dato leído/asignado.
    (contexto
      ? String(
          consulados
            .flatMap((c) => c.mesas)
            .find((m) => m.id === contexto.mesaId)?.numero ?? ""
        ).replace(/\D/g, "") || null
      : null) ??
    null;

  // [hueco a] ZONA/PUESTO del grupo LEÍDO (identificación → ruteo
  // resuelto → VLM); la selección solo cierra la fila si nada se leyó.
  const zona = leido?.zona ?? consulado?.zona?.trim() ?? null;

  const puestoCodigo =
    leido?.puesto ?? consulado?.puesto.match(/^(\d+)/)?.[1] ?? null;

  // [DETERMINISTA PRIMERO] MUN = ciudad del consulado identificado
  // (mockup del diseño: "MUN: ROMA"); el país del consulado y luego
  // la lectura VLM son los respaldos.
  const mun =
    consulado?.ciudad?.trim().toUpperCase() ||
    (analisis?.divipol?.pais || analisis?.divipol?.ciudad || analisis?.divipol?.municipio)
      ?.toUpperCase() ||
    consulado?.pais.toUpperCase() ||
    null;

  const nombrePuesto = consulado?.puesto ?? puestoActivo?.puesto ?? null;

  // [hueco b] KIT: footer impreso (4/4 en el golden) → dígitos 3-8
  // del barcode15 parseado. NUNCA hardcode.
  const kit =
    senalesLocales.footerKit ?? (parseado.ok ? Number(parseado.info.kit) : null);

  // [hueco c] totalPaginas: barcode15 parseado → señal impresa
  // Ver/Pag del acta → null ("—"). JAMÁS se inventa el dígito.
  const totalPaginas = parseado.ok
    ? parseado.info.totalPaginas
    : senalesLocales.totalPaginasOcr ?? null;

  // [hueco d] tipoEjemplar: barcode15 parseado → prop del envío →
  // clasificación local (tipoActaOcr, integra votos) → BANNER impreso
  // (tercera fuente).
  const tipo =
    (parseado.ok ? parseado.tipoEjemplar : null) ??
    (tipoEjemplar ? String(tipoEjemplar) : null) ??
    senalesLocales.tipoActaOcr ??
    senalesLocales.bannerTipo ??
    null;

  // [huecos a+e] ADVERTENCIA visible: lo LEÍDO (determinista)
  // contradice el consulado/mesa ACTIVO. Sin mezclar valores, sin
  // auto-enviar nada: solo el aviso al operario.
  const conflictoPuesto = conflictoPuestoActivo(leido, puestoActivo);
  const conflictoMesa = conflictoPuesto
    ? null
    : conflictoMesaEnviada(leido, mesa);

  const rutaRapida = [
    consulado?.pais ?? mun,
    zona ? `ZONA ${zona}` : null,
    nombrePuesto,
    mesaNumero ? `MESA ${String(mesaNumero).padStart(3, "0")}` : null,
    tipo,
    `PÁG ${pagina} DE ${totalPaginas}`,
  ]
    .filter(Boolean)
    .join(" > ")
    .toUpperCase();

  return (
    <section className="flex h-full flex-col bg-black">
      {/* ===== HEADER brand (diseño de revisión) ===== */}
      <header className="relative z-40 flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-black/95 px-4 backdrop-blur-md">
        <button
          type="button"
          aria-label="Volver al menú de escaneo"
          onClick={nuevaCaptura}
          className="grid h-11 w-11 -ml-2 place-items-center rounded-full text-brand-500 transition-transform duration-150 active:scale-95 active:bg-white/10"
        >
          <ArrowLeft className="h-6 w-6" strokeWidth={2} />
        </button>

        <div className="flex flex-col items-center">
          <h1 className="text-base font-extrabold uppercase tracking-wider text-brand-500">
            REVISIÓN DE ACTA
          </h1>
          <span className="font-mono text-[10px] uppercase tracking-widest text-zinc-400">
            E-14
          </span>
        </div>

        <div
          className="-mr-2 flex h-11 w-11 items-center justify-center"
          title={esEnCola ? "En cola local — se sincronizará al reconectar" : "Sincronizado con servidor central"}
        >
          <div
            aria-label={esEnCola ? "En cola offline" : "Sincronizado con servidor central"}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2 py-1",
              esEnCola
                ? "border-warning/50 bg-warning/10"
                : "border-brand-500/40 bg-brand-900/60"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 animate-pulse-sync rounded-full",
                esEnCola ? "bg-warning" : "bg-brand-500"
              )}
            />
            <Cloud
              className={cn(
                "h-3.5 w-3.5 fill-current",
                esEnCola ? "text-warning" : "text-brand-400"
              )}
            />
          </div>
        </div>
      </header>

      {/* ===== CONTENIDO ===== */}
      <div className="fine-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-3 pt-3">
        {/* Píldora de estado (mockup: "✓ 9.8/10 ÓPTIMA · ENVIADO CORRECTAMENTE") */}
        <div
          data-testid="exito-pill"
          className={cn(
            "flex items-center justify-center gap-2 self-center rounded-full border px-4 py-2 shadow-lg shadow-black/60 backdrop-blur-xl",
            esValidado
              ? "border-brand-500/50 bg-brand-500/15"
              : esEnCola || esAnomalia
                ? "border-warning/50 bg-warning/10"
                : "border-red-500/50 bg-red-500/10"
          )}
        >
          <span
            className={cn(
              "h-2 w-2 shrink-0 animate-pulse-sync rounded-full",
              esValidado
                ? "bg-brand-500 ring-4 ring-brand-500/20"
                : esEnCola || esAnomalia
                  ? "bg-warning ring-4 ring-warning/20"
                  : "bg-red-500 ring-4 ring-red-500/20"
            )}
          />
          <span
            className={cn(
              "font-mono text-[12px] font-bold tracking-wide",
              esValidado
                ? "text-brand-400"
                : esEnCola || esAnomalia
                  ? "text-warning"
                  : "text-red-400"
            )}
          >
            {esValidado ? "✓" : esEnCola || esAnomalia ? "⚠" : "✕"} {scoreVisual}/10 {estilo.texto}
          </span>
          <span className="text-[11px] text-zinc-500">•</span>
          <span className="text-[12px] font-extrabold uppercase tracking-wide text-white">
            {estadoLabel}
          </span>
        </div>

        {/* Ruta del acta (título + ruta mono — misma info de la tarjeta) */}
        <div className="text-center">
          <h2 className="text-[15px] font-extrabold uppercase tracking-wide text-white">
            {nombrePuesto ? nombrePuesto.replace(/^(\d+)\s*-\s*/, "").toUpperCase() : (mun ?? "ACTA E-14")}
          </h2>
          {rutaRapida && (
            <p className="mt-0.5 truncate font-mono text-[9px] font-semibold tracking-wide text-zinc-400">
              {rutaRapida}
            </p>
          )}
          {esRechazado && (
            <p className="mx-auto mt-1 max-w-xs text-[11px] text-red-400">{motivo}</p>
          )}
        </div>

        {/* ===== [T15 · huecos a+e] ADVERTENCIA de conflicto ===== */}
        {/* Lo LEÍDO (determinista) contradice el consulado/mesa ACTIVO:
            aviso visible, sin mezclar valores, sin auto-enviar nada. */}
        {conflictoPuesto && (
          <div
            data-testid="aviso-conflicto-puesto"
            role="alert"
            className="flex w-full items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-left shadow-lg shadow-black/40"
          >
            <ShieldAlert className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-warning">
              EL ACTA CORRESPONDE A OTRO PUESTO: LEÍDO {conflictoPuesto.leido} VS
              SELECCIONADO {conflictoPuesto.seleccionado}
            </p>
          </div>
        )}
        {conflictoMesa && !conflictoPuesto && (
          <div
            data-testid="aviso-conflicto-mesa"
            role="alert"
            className="flex w-full items-center gap-2.5 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-left shadow-lg shadow-black/40"
          >
            <ShieldAlert className="h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[11px] font-bold leading-snug text-warning">
              EL ACTA CORRESPONDE A OTRA MESA: LEÍDO {conflictoMesa.leido} VS
              SELECCIONADA {conflictoMesa.seleccionado}
            </p>
          </div>
        )}

        {/* [OLA4 4.6] SIGUIENTE OBJETIVO (captura dirigida) */}
        {siguienteObjetivo && !esRechazado && (
          <div
            data-testid="siguiente-objetivo"
            className="ranura-enter flex w-full items-center gap-3 self-center rounded-xl border border-brand-500/40 bg-brand-500/10 p-2.5 text-left shadow-[0_0_24px_rgba(0,230,118,0.15)]"
          >
            <ShieldCheck className="h-5 w-5 shrink-0 text-brand-500" />
            <div className="min-w-0 flex-1">
              <p className="label-caps flex items-center gap-1.5 text-brand-400">
                <span className="inline-block h-1.5 w-1.5 animate-pulse-sync rounded-full bg-brand-500" />
                {siguienteObjetivo.mesaCompleta ? "MESA COMPLETA" : "SIGUIENTE OBJETIVO"}
              </p>
              <p className="data-mono truncate text-[12px] font-bold text-white">
                {siguienteObjetivo.etiqueta}
              </p>
            </div>
          </div>
        )}

        {/* ===== ACTA REAL — imagen del pliego digitalizado ===== */}
        <div className="relative mx-auto w-full max-w-[360px] flex-1 py-2">
          {/* Marco de esquinas (verde — banda óptima / ámbar / rojo) */}
          <div className="pointer-events-none absolute inset-0 z-10">
            <div className={cn("scanner-frame", estilo.frame)}>
              <span className="corner-bl" />
              <span className="corner-br" />
            </div>
          </div>
          <div className="fine-scroll flex h-full items-start justify-center overflow-y-auto py-2">
            {/* [SOLO ACTAS REALES · CLAUDE.md · REGLA ABSOLUTA] La IMAGEN
                REAL del pliego (warp del flujo real — la misma que viajó
                al servidor) en el espacio que el diseño de esta pantalla
                reserva para el acta. NUNCA un re-dibujo o documento
                sintético. */}
            <figure className="w-full" data-testid="acta-real">
              {imagenActa ? (
                <>
                  <div className="relative overflow-hidden rounded-sm border border-white/15 bg-zinc-950">
                    <img
                      src={imagenActa}
                      alt="Acta E-14 escaneada — imagen real digitalizada del pliego"
                      className="mx-auto max-h-[300px] w-full select-none object-contain"
                      draggable={false}
                    />
                  </div>
                  <figcaption className="flex items-center justify-between pt-1 font-mono text-[8px] tracking-wider text-zinc-500">
                    <span className="flex items-center gap-1">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-500" />
                      ACTA ESCANEADA
                    </span>
                    <span>IMAGEN REAL · DIGITALIZADA</span>
                  </figcaption>
                </>
              ) : (
                <div className="flex min-h-[180px] w-full items-center justify-center rounded-sm border border-dashed border-white/20 font-mono text-[10px] font-bold text-zinc-500">
                  — SIN IMAGEN DEL ACTA —
                </div>
              )}
            </figure>
          </div>
        </div>

        {/* ===== [T15] PANEL DE INFORMACIÓN — lo LEÍDO del acta REAL ===== */}
        {/* Campos de información del diseño: ruteo resuelto (zona/puesto/
            mesa), KIT, página y tipo de ejemplar. Honestidad S-11: lo no
            leído se muestra "—" — JAMÁS se inventa. */}
        <div
          data-testid="panel-info-acta"
          className="mx-auto w-full max-w-[360px] rounded-xl border border-white/10 bg-zinc-950/90 p-3"
        >
          <p className="label-caps mb-2 flex items-center gap-1.5 text-zinc-400">
            <ScanLine className="h-3 w-3" aria-hidden="true" />
            Información leída del acta
          </p>
          <dl className="grid grid-cols-3 gap-x-2 gap-y-2.5">
            <InfoCampo testid="info-zona" label="Zona" valor={zona} />
            <InfoCampo testid="info-puesto" label="Puesto" valor={puestoCodigo} />
            {/* Mesa en canon E-14 (3 dígitos): el ruteo la trae como
                número (1) y la identificación como texto ("001") — el
                valor es el mismo, el formato es el del formulario. */}
            <InfoCampo
              testid="info-mesa"
              label="Mesa"
              valor={
                mesaNumero != null
                  ? String(Number(mesaNumero)).padStart(3, "0")
                  : null
              }
            />
            <InfoCampo testid="info-kit" label="Kit" valor={kit} />
            <InfoCampo
              testid="info-pag"
              label="Página"
              valor={
                parseado.ok || senalesLocales.paginaOcr != null || pagina != null
                  ? `PÁG ${
                      parseado.ok
                        ? parseado.info.pagina
                        : (senalesLocales.paginaOcr ?? pagina)
                    } DE ${totalPaginas ?? 2}`
                  : null
              }
            />
            <InfoCampo
              testid="info-tipo"
              label="Formulario"
              valor={
                tipo === "TRANSMISION"
                  ? "TRANSMISIÓN"
                  : tipo === "DELEGADOS"
                    ? "DELEGADOS"
                    : tipo
              }
            />
          </dl>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {/* [T15 · pto 6] Firmas: presencia detectada (VLM) — chip de
                estado; el trazo simulado se eliminó con ActaDocumento. */}
            <span
              data-testid="chip-firmas"
              className={cn(
                "data-mono rounded border px-2 py-0.5 text-[9px] font-bold",
                analisis?.firmasDetectadas
                  ? "border-brand-500/40 bg-brand-500/10 text-brand-400"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400"
              )}
            >
              FIRMAS: {analisis?.firmasDetectadas ? "DETECTADAS ✓" : "—"}
            </span>
            {/* [hueco a] Estado del ruteo OCR (valores + estado + motivo) */}
            <span
              data-testid="chip-ruteo"
              className="data-mono rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[9px] font-bold text-zinc-400"
              title={
                ocrRuteo
                  ? ocrRuteo.mesaIdSugerido
                    ? "Ruteo del encabezado DIVIPOL resuelto contra el catálogo local"
                    : "Ruteo del encabezado DIVIPOL sin match (el servidor valida)"
                  : "Sin OCR de ruteo para esta captura"
              }
            >
              RUTEO OCR: {ocrRuteo?.mesaIdSugerido ? "LEÍDO ✓" : "—"}
            </span>
          </div>
        </div>

        {/* ===== [PANTALLA COMPLETA] botón del acta digitalizada ===== */}
        <button
          type="button"
          data-testid="btn-ver-acta-digitalizada"
          onClick={() => setVerActa(true)}
          disabled={!imagenActa}
          className="flex h-11 w-full max-w-[360px] items-center justify-center gap-2 self-center rounded-xl border border-brand-500/40 bg-brand-500/10 text-[12px] font-extrabold uppercase tracking-wider text-brand-400 transition-all hover:bg-brand-500/20 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          <Maximize2 className="h-4 w-4" />
          Ver acta digitalizada en pantalla completa
        </button>

        {/* Píldora inferior del formulario (como el visor de revisión) */}
        <p className="flex items-center justify-center gap-1.5 self-center rounded-full bg-zinc-900/90 px-3 py-1.5 font-mono text-[9px] font-bold text-zinc-300">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              esValidado ? "bg-brand-500" : esEnCola || esAnomalia ? "bg-warning" : "bg-red-500"
            )}
          />
          PÁG {pagina ?? 1} DE {totalPaginas ?? 2} — FORMULARIO{" "}
          {tipo === "TRANSMISION" ? "TRANSMISIÓN" : tipo === "DELEGADOS" ? "DELEGADOS" : "—"} (E-14)
        </p>

        {/* Hora del envío + motivo no bloqueante */}
        {!esRechazado && (
          <p className="flex items-center justify-center gap-1.5 text-center font-mono text-[10px] text-zinc-500">
            <Clock className="h-3 w-3" />
            {esEnCola ? "GUARDADA" : "ENVIADA"} {fechaBogota(hora)} ·{" "}
            {esValidado ? "VALIDACIÓN AUTOMÁTICA RN-02" : "REQUIERE AUDITORÍA"}
            {esAnomalia && motivo ? ` · ${motivo}` : ""}
            {/* [DUPLICADO = ÉXITO] Nota discreta de auditoría: la hoja
                ya estaba registrada y el sistema lo confirmó — nunca
                se muestra como rechazo. */}
            {ultimoEnvio.yaRegistrada ? " · YA REGISTRADA ✓" : ""}
          </p>
        )}
      </div>

      {/* ===== PANTALLA COMPLETA — ACTA DIGITALIZADA ===== */}
      {verActa && imagenActa && (
        <div
          data-testid="visor-acta-digitalizada"
          className="fixed inset-0 z-[70] flex flex-col bg-black"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-brand-500" />
              <span className="text-[12px] font-extrabold uppercase tracking-wider text-white">
                ACTA DIGITALIZADA (E-14)
              </span>
            </div>
            <button
              type="button"
              aria-label="Salir de pantalla completa"
              onClick={() => setVerActa(false)}
              className="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/60 text-white transition-transform active:scale-95"
            >
              <Minimize2 className="h-5 w-5" />
            </button>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
            <img
              src={imagenActa}
              alt="Acta digitalizada en pantalla completa"
              className="h-full w-full select-none object-contain"
              draggable={false}
            />
          </div>
          <p className="shrink-0 pb-[max(env(safe-area-inset-bottom),12px)] text-center font-mono text-[9px] text-zinc-500">
            {rutaRapida || "ACTA E-14 DIGITALIZADA"}
          </p>
        </div>
      )}

      {/* ===== CTA SEGUIR ESCANEANDO (diseño: verde glow) ===== */}
      <div className="shrink-0 px-4 pb-3 pt-1">
        <button
          type="button"
          data-testid="btn-seguir-escaneando"
          onClick={nuevaCaptura}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-brand-500 text-base font-extrabold uppercase tracking-wider text-black shadow-glow-pill transition-all hover:bg-brand-400 active:scale-[0.98]"
        >
          <ScanLine className="h-5 w-5 text-black" />
          {esRechazado ? (
            <>
              <ShieldAlert className="h-5 w-5 text-black" /> REINTENTAR ESCANEO
            </>
          ) : (
            "SEGUIR ESCANEANDO"
          )}
        </button>
      </div>
    </section>
  );
}
