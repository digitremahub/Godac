import type { Metadata, Viewport } from "next";
import { Syne, DM_Sans } from "next/font/google";
import "./globals.css";

// Brand guide (Notion — Naming & Identité de Marque V2): Syne for
// titles and the logo, DM Sans for body copy.
const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-heading",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
    <html lang="fr" className={`${syne.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
