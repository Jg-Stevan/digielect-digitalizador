import type { NextConfig } from "next";

// ============================================================
// DIGITALIZADOR E-14 — export estática para GitHub Pages
// ============================================================
// La app es 100% cliente (PWA offline): `output: "export"` SIEMPRE.
// El basePath es configurable por env:
//   · GitHub Pages  → NEXT_PUBLIC_BASE_PATH=/digielect-digitalizador (default)
//   · dominio propio / prueba local → NEXT_PUBLIC_BASE_PATH= (vacío)
// La API del supervisor es externa: NEXT_PUBLIC_API_BASE_URL (Fase 6).
// ============================================================

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// `??` (no `||`): el .env.example documenta "Vacío = servir en la raíz"
// — con `||` un valor explícitamente vacío era imposible desde .env.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/digielect-digitalizador";
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "package.json"), "utf8")
);

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    // Versión de la app visible en PantallaInicio (Fase 8)
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    // Inline en el bundle cliente para lib/env.ts
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Host Node de digielect (supervisor + API de ingesta). Sin valor
    // → modo local puro (cola offline, sin upload): válido para pruebas.
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  },
  reactStrictMode: false,
};

export default nextConfig;
