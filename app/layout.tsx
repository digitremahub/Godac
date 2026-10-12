import type { Metadata, Viewport } from "next";
import { Poppins, Inter } from "next/font/google";
import "./globals.css";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GODAC — Gestion et Optimisation Des Assets et Carburant",
  description:
    "L'OS de backoffice pour les entreprises de transport routier de marchandises : carburant, flotte, RH, planning et conformité.",
  // iOS only exposes PushManager to a page added to the home screen and
  // reopened from there — this meta (on top of app/manifest.ts) is what
  // makes "Ajouter à l'écran d'accueil" register as a standalone app
  // reliably across iOS versions, not just 16.4+'s manifest-only path.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GODAC",
  },
};

export const viewport: Viewport = {
  // Matches the page background (paper) so the mobile browser chrome
  // blends into the app instead of a bright teal band above it.
  themeColor: "#F6F7FB",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${poppins.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
