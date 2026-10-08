import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Inter, JetBrains_Mono, Space_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { withBasePath } from "@/lib/env";
import { RegistrarSW } from "@/components/pwa/RegistrarSW";
import { ActualizarAppBanner } from "@/components/pwa/ActualizarAppBanner";

const hankenGrotesk = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

/** Inter: tipografía oficial del PWA Digitalizador (diseño Stitch) */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/** Space Mono: datos mono del diseño Stitch industrial (C-15) */
const spaceMono = Space_Mono({
  variable: "--font-mono-space",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Digitalizador E-14 — PWA del jurado de votación",
  description:
    "Escaneo en alta calidad del acta E-14, extracción de datos impresos de ruteo (departamento, municipio, zona, puesto, mesa) y guardado en el lugar correcto. Offline-first.",
  keywords: [
    "E-14",
    "Registraduría",
    "elecciones",
    "Colombia",
    "digitalización",
    "jurado de votación",
  ],
  manifest: withBasePath("/manifest.webmanifest"),
  icons: {
    icon: withBasePath("/icon.svg"),
    apple: withBasePath("/e14/icono-pwa-192.png"),
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Digitalizador E-14",
  },
};

export const viewport: Viewport = {
  themeColor: "#0e1414",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${hankenGrotesk.variable} ${jetbrainsMono.variable} ${inter.variable} ${spaceMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <ActualizarAppBanner />
        <Toaster />
        {/* Service Worker mínimo — PWA real, assets y vendor de OCR
            cacheados para la jornada sin red (Fase 8 lo versiona). */}
        <RegistrarSW />
      </body>
    </html>
  );
}
