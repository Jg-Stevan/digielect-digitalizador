#!/usr/bin/env node
// ============================================================
// test:contrato — contract test rápido del repo (Fase 9 · plan §11.1)
//  1. src/lib/contrato/VERSION existe y es semver
//  2. scanner-adapter.ts NO referencia data.quad ni data.id
//     (anti-regresión del protocolo real del worker)
//  3. public/vendor/opencv-4.5.5.js existe (Invariante 7)
//  4. Ningún `new Worker(` sin withBasePath (Invariante 8)
//  5. Ninguna zona manuscrita declarada (Regla de Producto:
//     los votos no se leen — sin kind:"mano", OCR sólo en ZONAS_RUTEO_E14)
// ============================================================

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = process.cwd();
let fallos = 0;
const fallar = (msg) => {
  console.error(`✗ ${msg}`);
  fallos++;
};
const ok = (msg) => console.log(`✓ ${msg}`);

// 1) VERSION semver
const rutaVersion = join(RAIZ, "src/lib/contrato/VERSION");
if (!existsSync(rutaVersion)) {
  fallar("src/lib/contrato/VERSION no existe");
} else {
  const v = readFileSync(rutaVersion, "utf8").trim();
  if (/^\d+\.\d+\.\d+$/.test(v)) ok(`contrato VERSION ${v} (semver)`);
  else fallar(`VERSION "${v}" no es semver`);
}

// 2) anti-regresión del protocolo en scanner-adapter
const adapter = readFileSync(join(RAIZ, "src/lib/scanner-adapter.ts"), "utf8");
if (/data\.quad\b/.test(adapter)) fallar("scanner-adapter usa `data.quad` — el protocolo real usa `corners`");
else ok("scanner-adapter sin `data.quad` (protocolo real)");
if (/\.get\(data\.id\)|pendientes\.get\(data\.id\)/.test(adapter)) fallar("scanner-adapter correlaciona por `id` — el protocolo real usa `ts`");
else ok("scanner-adapter sin correlación por `id` (usa `ts`)");
if (!/m\.ts/.test(adapter)) fallar("scanner-adapter no lee m.ts (correlación)");
if (!/message/.test(adapter)) fallar("scanner-adapter no usa el campo `message` en error");

// 3) opencv con nombre EXACTO
const opencv = join(RAIZ, "public/vendor/opencv-4.5.5.js");
if (!existsSync(opencv)) fallar("falta public/vendor/opencv-4.5.5.js (Invariante 7 — offline roto)");
else ok("public/vendor/opencv-4.5.5.js presente (nombre exacto)");

// 4) new Worker siempre con withBasePath (carpetas SYNC del upstream
//    excluidas: su manejo de URLs es responsabilidad de web-scanner)
function listar(dir, acc = []) {
  for (const n of readdirSync(dir)) {
    const full = join(dir, n);
    if (statSync(full).isDirectory()) {
      if (n === "node_modules" || n === ".next" || n === "out" || n === ".git" || n === "scanner-core") continue;
      listar(full, acc);
    } else if (/\.(ts|tsx)$/.test(n)) acc.push(full);
  }
  return acc;
}
let workersMalos = 0;
for (const f of listar(join(RAIZ, "src"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/new Worker\(([^)]*)\)/g)) {
    if (!m[1].includes("withBasePath")) {
      fallar(`${f.replace(RAIZ + "/", "")}: new Worker sin withBasePath — "${m[0].slice(0, 70)}"`);
      workersMalos++;
    }
  }
}
if (workersMalos === 0) ok("todo new Worker( va con withBasePath (Invariante 8)");

// 5) Regla de Producto: sin zonas manuscritas
const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const zonas = sinComentarios(readFileSync(join(RAIZ, "src/lib/ocr/zonas-e14.ts"), "utf8"));
if (/kind:\s*"mano"|manuscrit/i.test(zonas)) fallar("zonas-e14 declara campos manuscritos — REGLA DE PRODUCTO VIOLADA");
else ok("zonas-e14 sin campos manuscritos (Regla de Producto)");

const ruteo = sinComentarios(readFileSync(join(RAIZ, "src/lib/ocr/ruteo.ts"), "utf8"));
if (/votos|candidat/i.test(ruteo)) fallar("ruteo.ts menciona votos/candidaturas fuera de comentarios");
else ok("ruteo.ts no procesa votos (Regla de Producto)");

if (fallos > 0) {
  console.error(`\n✗ CONTRACT TEST FALLÓ (${fallos})`);
  process.exit(1);
}
console.log("\n✓ CONTRACT TEST OK");
