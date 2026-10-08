/* AUTO-GENERADO por `bun run sync:scanner` — NO EDITAR.
   Fuente: web-scanner@c225fbea91ebf76bea12fe4ad355f578b4bff3d5. Editar en el repo upstream. */
/**
 * Datos mock deterministas (sin Math.random / Date.now en tiempo de módulo)
 * para evitar desajustes de hidratación SSR/cliente.
 */

import type { ScanDocument, ScanPage } from "./types";

/** Timestamp base fijo: 2026-10-02 12:00 UTC (la fecha del sistema). */
export const BASE_TIME = 1789977600000;

function svgThumb(kind: "invoice" | "form" | "id" | "notes" | "contract" | "brainstorm"): string {
  const W = 160;
  const H = 200;
  const bg = "#faf8f2";
  const dark = "#1c1c1e";
  const gray = "#9a9aa0";
  const blue = "#007aff";
  const lines = (n: number, y0: number, gap: number, widths: number[][]) => {
    let out = "";
    for (let i = 0; i < n; i++) {
      const w = widths[i % widths.length];
      out += `<rect x="${w[0]}" y="${y0 + i * gap}" width="${w[1]}" height="6" rx="3" fill="${gray}" opacity="0.55"/>`;
    }
    return out;
  };
  let content = "";
  switch (kind) {
    case "invoice":
      content = `
        <rect x="14" y="14" width="60" height="34" rx="4" fill="${blue}" opacity="0.9"/>
        <rect x="84" y="18" width="58" height="8" rx="4" fill="${dark}"/>
        <rect x="84" y="32" width="44" height="6" rx="3" fill="${gray}"/>
        ${lines(2, 66, 16, [[14, 132]])}
        <rect x="14" y="104" width="132" height="1.5" fill="#e5e5ea"/>
        ${lines(4, 116, 14, [[14, 90], [14, 60]])}
        <rect x="14" y="180" width="132" height="1.5" fill="#e5e5ea"/>
        <rect x="96" y="150" width="50" height="10" rx="5" fill="${blue}" opacity="0.85"/>
        <rect x="18" y="160" width="42" height="22" rx="3" fill="none" stroke="#ff3b30" stroke-width="2" opacity="0.7"/>
        <rect x="24" y="167" width="30" height="7" rx="2" fill="#ff3b30" opacity="0.7"/>
      `;
      break;
    case "form":
      content = `
        <rect x="14" y="14" width="132" height="12" rx="6" fill="${dark}"/>
        ${lines(3, 40, 14, [[14, 100], [14, 70]])}
        <rect x="14" y="86" width="132" height="34" rx="4" fill="#f2f2f7" stroke="#c7c7cc"/>
        ${lines(2, 96, 12, [[22, 80]])}
        <rect x="14" y="132" width="132" height="34" rx="4" fill="#f2f2f7" stroke="#c7c7cc"/>
        ${lines(2, 142, 12, [[22, 60]])}
        <rect x="44" y="178" width="72" height="10" rx="5" fill="${blue}" opacity="0.85"/>
      `;
      break;
    case "id":
      content = `
        <rect x="14" y="14" width="132" height="170" rx="8" fill="#ffffff" stroke="#c7c7cc"/>
        <rect x="22" y="24" width="52" height="64" rx="4" fill="#d9e6f7"/>
        <circle cx="48" cy="48" r="14" fill="#8e8e93"/>
        <rect x="30" y="70" width="36" height="14" rx="7" fill="#8e8e93" opacity="0.6"/>
        ${lines(4, 100, 14, [[22, 90], [22, 60]])}
        <rect x="110" y="158" width="28" height="10" rx="5" fill="#ff9500" opacity="0.8"/>
      `;
      break;
    case "notes":
      content = `
        <rect x="14" y="10" width="132" height="180" rx="4" fill="#fffbe8" stroke="#e8e0b8"/>
        ${lines(12, 26, 14, [[20, 118], [20, 92], [20, 60]])}
        <rect x="20" y="158" width="46" height="20" rx="3" fill="none" stroke="#007aff" stroke-width="1.5" opacity="0.6"/>
      `;
      break;
    case "contract":
      content = `
        <rect x="14" y="14" width="132" height="12" rx="6" fill="${dark}"/>
        ${lines(10, 38, 13, [[14, 128], [14, 96], [14, 64]])}
        <rect x="14" y="172" width="60" height="14" rx="3" fill="none" stroke="#3c3c43" stroke-width="1.5"/>
        <path d="M 24 180 q 10 -12 20 0 q 10 -12 20 0" fill="none" stroke="#3c3c43" stroke-width="1.5"/>
      `;
      break;
    case "brainstorm":
      content = `
        <rect x="14" y="14" width="132" height="12" rx="6" fill="${dark}"/>
        <circle cx="40" cy="70" r="24" fill="#e8f0fe" stroke="${blue}"/>
        <circle cx="110" cy="60" r="20" fill="#eaf7ec" stroke="#34c759"/>
        <circle cx="70" cy="120" r="22" fill="#fff0e8" stroke="#ff9500"/>
        <rect x="34" y="160" width="90" height="8" rx="4" fill="${gray}"/>
        <rect x="50" y="176" width="60" height="8" rx="4" fill="${gray}" opacity="0.6"/>
      `;
      break;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${content}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function page(
  id: string,
  kind: Parameters<typeof svgThumb>[0],
  minutesAgo: number,
  ocr?: string
): ScanPage {
  const img = svgThumb(kind);
  return {
    id,
    original: img,
    processed: img,
    thumbnail: img,
    filter: "text" as const,
    quad: [
      { x: 0.05, y: 0.06 },
      { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 },
      { x: 0.05, y: 0.95 },
    ],
    rotation: 0,
    quality: {
      level: "excellent" as const,
      sharpness: 91,
      brightness: 88,
      contrast: 86,
      label: "Excelente",
    },
    ocrText: ocr,
    ocrDone: Boolean(ocr),
    createdAt: BASE_TIME - minutesAgo * 60000,
  };
}

export function initialDocuments(): ScanDocument[] {
  const H = 3600000;
  return [
    {
      id: "doc-001",
      title: "Recibo de servicios",
      pages: [page("p-001a", "invoice", 0, "GLOBAL SYNERGY LTD.\nFACTURA #GSS-2026-041\n\nConcepto: Consultoría Estratégica — €3,500.00\nLicencias Software Anual — €3,600.00\nDirección de Proyecto GSS — €3,600.00\n\nTOTAL A PAGAR: €16,800.00")],
      favorite: true,
      tags: ["Facturas", "Casa"],
      createdAt: BASE_TIME - 3 * H,
      updatedAt: BASE_TIME - 3 * H,
    },
    {
      id: "doc-002",
      title: "Formulario de solicitud",
      pages: [
        page("p-002a", "form", 24),
        page("p-002b", "form", 24),
      ],
      favorite: false,
      createdAt: BASE_TIME - 24 * H,
      updatedAt: BASE_TIME - 24 * H,
    },
    {
      id: "doc-003",
      title: "Cédula de identidad",
      pages: [page("p-003a", "id", 48)],
      favorite: true,
      tags: ["Personal", "Importante"],
      createdAt: BASE_TIME - 48 * H,
      updatedAt: BASE_TIME - 48 * H,
    },
    {
      id: "doc-004",
      title: "Brainstorm proyecto",
      pages: [page("p-004a", "brainstorm", 72)],
      favorite: false,
      createdAt: BASE_TIME - 72 * H,
      updatedAt: BASE_TIME - 72 * H,
    },
    {
      id: "doc-005",
      title: "Apuntes clase 3",
      pages: [page("p-005a", "notes", 96)],
      favorite: false,
      tags: ["Universidad"],
      createdAt: BASE_TIME - 96 * H,
      updatedAt: BASE_TIME - 96 * H,
    },
    {
      id: "doc-006",
      title: "Contrato de arriendo",
      pages: [
        page("p-006a", "contract", 120),
        page("p-006b", "contract", 120),
      ],
      favorite: false,
      tags: ["Casa", "Legal"],
      createdAt: BASE_TIME - 120 * H,
      updatedAt: BASE_TIME - 120 * H,
    },
  ];
}
