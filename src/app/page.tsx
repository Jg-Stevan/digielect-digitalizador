"use client";

// ============================================================
// DIGITALIZADOR E-14 — PWA del jurado (repo separado)
// Toda la app ES el digitalizador: sin props de sesión. El flujo
// de identificación de puesto ya existe dentro de la PWA
// (PantallaInicio → puestoActivo persistido en IndexedDB).
// ============================================================

import { DigitalizadorApp } from "@/components/digitalizador/DigitalizadorApp";

export default function Page() {
  return <DigitalizadorApp />;
}
