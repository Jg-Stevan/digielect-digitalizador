#!/usr/bin/env node
// ============================================================
// sync:contrato — sincroniza src/lib/contrato desde digielect
// (upstream del contrato). Banner AUTO-GENERADO + informe de
// cambios (diff de archivos) listo para el PR.
//   · remoto (default): raw.githubusercontent.com/Jg-Stevan/digielect/<ref>/src/lib/contrato/**
//   · --ref <sha|rama>: versión del upstream (default: main)
//   · --local ../digielect: copia del checkout hermano
// El humano aprueba el PR con el informe.
// ============================================================

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Jg-Stevan/digielect";
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINO = join(RAIZ, "src/lib/contrato");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { ref: "main", local: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--ref" && args[i + 1]) out.ref = args[++i];
    else if (args[i] === "--local" && args[i + 1]) out.local = args[++i];
  }
  return out;
}

const BANNER = (ref) =>
  `// AUTO-GENERADO por \`bun run sync:contrato\` — NO EDITAR.\n// Fuente: digielect@${ref} (src/lib/contrato). Editar en el repo upstream.\n`;

const args = parseArgs();

async function listarRemoto(ref) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/src/lib/contrato?ref=${encodeURIComponent(ref)}`, {
    headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
  });
  if (!res.ok) throw new Error(`contents falló (HTTP ${res.status})`);
  const data = await res.json();
  return data.filter((f) => f.type === "file").map((f) => f.name);
}

function listarLocal(root) {
  return readdirSync(root).filter((f) => statSync(join(root, f)).isFile());
}

async function main() {
  const fuenteLocal = args.local ? resolve(RAIZ, args.local) : null;
  if (fuenteLocal && !existsSync(join(fuenteLocal, "src/lib/contrato"))) {
    console.error(`✗ ${fuenteLocal} no contiene src/lib/contrato`);
    process.exit(1);
  }
  console.log(fuenteLocal ? `· modo LOCAL: ${fuenteLocal}` : `· remoto: ${REPO}@${args.ref}`);

  const archivos = fuenteLocal
    ? listarLocal(join(fuenteLocal, "src/lib/contrato"))
    : await listarRemoto(args.ref);
  if (!archivos.includes("types.ts")) {
    console.error("✗ el upstream no expone types.ts — ¿estructura cambiada?");
    process.exit(1);
  }

  const antes = new Map();
  if (existsSync(DESTINO)) {
    for (const f of readdirSync(DESTINO)) {
      try {
        antes.set(f, createHash("sha256").update(readFileSync(join(DESTINO, f))).digest("hex"));
      } catch { /* binario raro */ }
    }
  }

  mkdirSync(DESTINO, { recursive: true });
  const cambios = [];
  for (const nombre of archivos) {
    const contenido = fuenteLocal
      ? readFileSync(join(fuenteLocal, "src/lib/contrato", nombre))
      : Buffer.from(await (await fetch(`https://raw.githubusercontent.com/${REPO}/${args.ref}/src/lib/contrato/${nombre}`)).arrayBuffer());
    let final = contenido;
    if (nombre === "VERSION") {
      final = contenido; // limpio: lo leen herramientas como semver pelado
    } else if (nombre.endsWith(".md")) {
      final = Buffer.concat([Buffer.from(`<!-- ${BANNER(args.ref).replace(/^\/\/ /gm, "").trim()} -->\n\n`), contenido]);
    } else if (/\.(ts|js|mjs)$/.test(nombre)) {
      final = Buffer.concat([Buffer.from(BANNER(args.ref)), contenido]);
    }
    writeFileSync(join(DESTINO, nombre), final);
    const hash = createHash("sha256").update(final).digest("hex");
    const cambio = !antes.has(nombre) ? "+" : antes.get(nombre) !== hash ? "~" : "=";
    if (cambio !== "=") cambios.push(`${cambio} ${nombre}`);
  }

  console.log(`\n--- NOVEDADES DEL CONTRATO (${args.ref}) ---`);
  if (cambios.length === 0) console.log("· Sin cambios (contrato estable)");
  for (const c of cambios) console.log(c);
  if (cambios.some((c) => c.startsWith("+") && c.includes("types"))) {
    console.log("ACCIONES SUGERIDAS: revisar nuevos tipos del contrato y su uso en el digitalizador");
  }
  console.log(`\n✓ ${archivos.length} archivos del contrato sincronizados en src/lib/contrato/`);
}

await main();
