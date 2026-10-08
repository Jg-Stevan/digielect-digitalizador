#!/usr/bin/env node
// ============================================================
// sync:scanner — sincroniza el motor de visión desde web-scanner
// ============================================================
// Copia (recursiva y COMPLETA — sin listas fijas de archivos):
//   public/scanner/**   → public/scanner/**
//   src/lib/scanner/**  → src/lib/scanner-core/**  (imports @/lib/scanner/ remapeados)
//   public/vendor/**    → public/vendor/**         (opencv-4.5.5.js EXACTO + core)
//
// Reglas:
//   · SHA FIJADO en motor.ref (raíz). `--ref <sha>` actualiza el pin; sin
//     flag usa el pin existente; sin pin toma el SHA actual de main vía API,
//     lo fija y avisa. NUNCA sincroniza implícitamente desde un main móvil.
//   · Banner AUTO-GENERADO al inicio de cada archivo de texto copiado.
//   · Manifiesto version-motor.json + src/lib/motor-version.ts con SHA-256
//     por archivo y capacidades detectadas (ops/modos del worker).
//   · Informe de NOVEDADES contra el manifiesto anterior.
//   · Modo local: `--local ../web-scanner` copia del checkout hermano con
//     las mismas reglas de banner/manifiesto.
//   · exit 1 si falta opencv-4.5.5.js o detection-worker.js (Invariante 7).
// ============================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.SYNC_SCANNER_REPO ?? "Jg-Stevan/web-scanner";
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PIN = join(RAIZ, "motor.ref");
const MANIFIESTO = join(RAIZ, "version-motor.json");
const MOTOR_VERSION_TS = join(RAIZ, "src/lib/motor-version.ts");

const BANNER = (sha) =>
  `/* AUTO-GENERADO por \`bun run sync:scanner\` — NO EDITAR.\n   Fuente: web-scanner@${sha}. Editar en el repo upstream. */\n`;

// ------------------------------------------------------------
// Args
// ------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const out = { ref: null, local: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ref" && args[i + 1]) { out.ref = args[++i]; }
    else if (args[i] === "--local" && args[i + 1]) { out.local = args[++i]; }
  }
  return out;
}

// ------------------------------------------------------------
// Pin del SHA
// ------------------------------------------------------------
async function resolverRef(args) {
  if (args.ref) {
    writeFileSync(PIN, args.ref + "\n", "utf8");
    console.log(`· pin ACTUALIZADO a ${args.ref.slice(0, 12)} (--ref)`);
    return args.ref;
  }
  if (existsSync(PIN)) {
    const pin = readFileSync(PIN, "utf8").trim();
    if (pin) {
      console.log(`· pin existente: ${pin.slice(0, 12)} (motor.ref)`);
      return pin;
    }
  }
  // Sin pin: fijar el SHA actual de main y AVISAR (nunca sincronizar móvil)
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`no se pudo resolver el SHA de main (HTTP ${res.status})`);
  const sha = (await res.json()).sha;
  writeFileSync(PIN, sha + "\n", "utf8");
  console.log(`⚠ SIN PIN PREVIO: se fijó el SHA actual de main (${sha.slice(0, 12)}) y quedó grabado en motor.ref.`);
  return sha;
}

// ------------------------------------------------------------
// Listado de archivos del upstream (remoto u local)
// ------------------------------------------------------------
async function listarRemoto(sha) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`git/trees falló (HTTP ${res.status})`);
  const data = await res.json();
  if (data.truncated) throw new Error("el árbol del repo upstream quedó truncado (repo demasiado grande para la API)");
  return data.tree.filter((t) => t.type === "blob").map((t) => t.path);
}

function listarLocal(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (name === ".git" || name === "node_modules" || name === ".next") continue;
        walk(full);
      } else {
        out.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return out;
}

/** Contenido de un archivo upstream (remoto: raw por SHA — URLs estables). */
async function leerRemoto(sha, path) {
  const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`);
  if (!res.ok) throw new Error(`raw falló para ${path} (HTTP ${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function leerLocal(root, path) {
  return readFileSync(join(root, path));
}

// ------------------------------------------------------------
// Capacidades del worker (regex sobre el bundle)
// ------------------------------------------------------------
function detectarCapacidades(workerSrc) {
  const ops = new Set();
  // NOTA: `detect` se despacha con forma NEGATIVA (`msg.type !== "detect"`)
  // en el bundle real — capturar === y !== para no perderla.
  for (const m of workerSrc.matchAll(/\bmsg\.type\s*(?:===|!==)\s*"(detect|warp|enhance|config)"/g)) ops.add(m[1]);
  const modos = new Set();
  for (const m of workerSrc.matchAll(/\bmode\s*(?:===|!==)\s*"(raw|color|gray|natural|text|bw)"/g)) modos.add(m[1]);
  // Salidas del protocolo
  const salidas = new Set();
  for (const m of workerSrc.matchAll(/type:\s*"(result|warped|enhanced|busy|boot|ready|error)"/g)) salidas.add(m[1]);
  return {
    ops: [...ops].sort(),
    modos: [...modos].sort(),
    salidas: [...salidas].sort(),
  };
}

// ------------------------------------------------------------
// Copia con banner + remapeo de imports
// ------------------------------------------------------------
const EXT_BANNER = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".css"]);

function ext(p) {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i);
}

function transformar(buf, src, sha) {
  let contenido = buf;
  if (EXT_BANNER.has(ext(src))) contenido = Buffer.concat([Buffer.from(BANNER(sha), "utf8"), buf]);
  // Remapeo de imports del paquete scanner → scanner-core (solo TS/JS)
  if (/\.(ts|tsx|js|mjs)$/.test(src)) {
    const texto = contenido.toString("utf8");
    const remapeado = texto.replace(/from\s+"@\/lib\/scanner\//g, 'from "@/lib/scanner-core/');
    if (remapeado !== texto) contenido = Buffer.from(remapeado, "utf8");
  }
  return contenido;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ------------------------------------------------------------
// Principal
// ------------------------------------------------------------
const args = parseArgs();
const sha = await resolverRef(args);
const fuenteLocal = args.local ? resolve(RAIZ, args.local) : null;
if (fuenteLocal && !existsSync(fuenteLocal)) {
  console.error(`✗ modo local: no existe ${fuenteLocal}`);
  process.exit(1);
}

console.log(fuenteLocal ? `· modo LOCAL: ${fuenteLocal}` : `· modo remoto: ${REPO}@${sha.slice(0, 12)}`);

const archivos = fuenteLocal ? listarLocal(fuenteLocal) : await listarRemoto(sha);

// Selección por PREFIJOS COMPLETOS (no listas fijas de archivos)
const REGLAS = [
  { prefijo: "public/scanner/", destino: "public/scanner/" },
  { prefijo: "src/lib/scanner/", destino: "src/lib/scanner-core/" },
  { prefijo: "public/vendor/", destino: "public/vendor/" },
];

const seleccion = archivos.filter((p) => REGLAS.some((r) => p.startsWith(r.prefijo)));
if (seleccion.length === 0) {
  console.error("✗ la selección quedó VACÍA: ¿el upstream cambió de estructura? Revisar prefijos.");
  process.exit(1);
}

// Copiar
const copiados = [];
for (const src of seleccion) {
  const regla = REGLAS.find((r) => src.startsWith(r.prefijo));
  const dst = regla.destino + src.slice(regla.prefijo.length);
  const buf = fuenteLocal ? leerLocal(fuenteLocal, src) : await leerRemoto(sha, src);
  const final = transformar(buf, src, sha);
  const dstFull = join(RAIZ, dst);
  mkdirSync(dirname(dstFull), { recursive: true });
  writeFileSync(dstFull, final);
  copiados.push({ src, dst, sha256: sha256(final), bytes: final.length });
}

// Puerta dura: archivos obligatorios (Invariante 7)
const tiene = (rel) => copiados.some((c) => c.dst === rel);
const faltantes = [];
if (!tiene("public/vendor/opencv-4.5.5.js")) faltantes.push("public/vendor/opencv-4.5.5.js");
if (!tiene("public/scanner/detection-worker.js")) faltantes.push("public/scanner/detection-worker.js");
if (faltantes.length > 0) {
  console.error(`✗ FALTAN archivos obligatorios del motor: ${faltantes.join(", ")}`);
  process.exit(1);
}

// Capacidades (sobre el worker ya copiado — sin banner para las regex)
const workerSrc = readFileSync(join(RAIZ, "public/scanner/detection-worker.js"), "utf8")
  .replace(BANNER(sha), "");
const capacidades = detectarCapacidades(workerSrc);

// Manifiesto nuevo
const manifiestoNuevo = {
  sha,
  fecha: new Date().toISOString(),
  repo: fuenteLocal ? `local:${args.local}` : REPO,
  archivos: copiados.map(({ dst, sha256, bytes }) => ({ ruta: dst, sha256, bytes })),
  capacidades,
};

// Comparar con el manifiesto anterior → NOVEDADES
const anterior = existsSync(MANIFIESTO) ? JSON.parse(readFileSync(MANIFIESTO, "utf8")) : null;
console.log(`\n--- NOVEDADES DEL MOTOR (${sha.slice(0, 7)}) ---`);
const rutasAnt = new Map((anterior?.archivos ?? []).map((a) => [a.ruta, a.sha256]));
const rutasNue = new Map(manifiestoNuevo.archivos.map((a) => [a.ruta, a.sha256]));
const nuevos = [...rutasNue.keys()].filter((r) => !rutasAnt.has(r));
const eliminados = [...rutasAnt.keys()].filter((r) => !rutasNue.has(r));
const cambiados = [...rutasNue.keys()].filter((r) => rutasAnt.has(r) && rutasAnt.get(r) !== rutasNue.get(r));
const opsAnt = anterior?.capacidades?.ops ?? [];
const modosAnt = anterior?.capacidades?.modos ?? [];
const opsNuevos = capacidades.ops.filter((o) => !opsAnt.includes(o));
const modosNuevos = capacidades.modos.filter((m) => !modosAnt.includes(m));
for (const n of nuevos) console.log(`+ Archivos nuevos: ${n}`);
for (const c of cambiados) console.log(`~ Archivos cambiados: ${c}`);
for (const e of eliminados) console.log(`- Archivos eliminados: ${e}`);
if (nuevos.length + cambiados.length + eliminados.length === 0) console.log("· Sin cambios de archivos");
console.log(`+ Ops worker: ${capacidades.ops.join(", ")}`);
console.log(`+ Modos disponibles: ${capacidades.modos.join(", ")}`);
const noUsados = capacidades.modos.filter((m) => !["raw", "text", "bw"].includes(m));
if (noUsados.length > 0) console.log(`  (no usados por el digitalizador: ${noUsados.join(", ")})`);
const protoCambio =
  anterior != null &&
  (JSON.stringify(anterior.capacidades?.ops) !== JSON.stringify(capacidades.ops) ||
    JSON.stringify(anterior.capacidades?.salidas) !== JSON.stringify(capacidades.salidas));
console.log(protoCambio ? "⚠ CAMBIO DE PROTOCOLO del worker — revisar scanner-adapter" : "~ Sin cambios de protocolo");
if (opsNuevos.length > 0 || modosNuevos.length > 0 || nuevos.length > 0) {
  console.log("ACCIONES SUGERIDAS:");
  for (const o of opsNuevos) console.log(`  · wire de la op nueva \`${o}\` en scanner-adapter si aplica al digitalizador`);
  for (const m of modosNuevos) console.log(`  · evaluar el modo nuevo \`${m}\` (solo si aporta al E-14; recordar: sin manuscritos)`);
  for (const n of nuevos) console.log(`  · revisar wiring de ${n} (capacidad nueva del motor)`);
} else {
  console.log("ACCIONES SUGERIDAS: (ninguna — sin capacidades nuevas)");
}

// Persistir manifiesto + motor-version.ts
writeFileSync(MANIFIESTO, JSON.stringify(manifiestoNuevo, null, 2) + "\n", "utf8");
mkdirSync(dirname(MOTOR_VERSION_TS), { recursive: true });
writeFileSync(
  MOTOR_VERSION_TS,
  `// AUTO-GENERADO por \`bun run sync:scanner\` — NO EDITAR.\n` +
  `// Fuente: web-scanner@${sha}.\n` +
  `export const MOTOR_VERSION = "${sha}";\n`,
  "utf8"
);

console.log(`\n✓ ${copiados.length} archivos sincronizados · manifiesto: version-motor.json · pin: motor.ref`);
