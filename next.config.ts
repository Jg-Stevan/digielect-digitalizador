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

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/digielect-digitalizador";

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    // Inline en el bundle cliente para lib/env.ts
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Host Node de digielect (supervisor + API de ingesta). Sin valor
    // → modo local puro (cola offline, sin upload): válido para pruebas.
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "",
  },
  reactStrictMode: false,
};

export default nextConfig;
