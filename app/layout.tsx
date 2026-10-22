import type { Metadata, Viewport } from "next";
import { SITE_URL } from "@/lib/site";
import { Syne, DM_Sans } from "next/font/google";
import "./globals.css";
import { DISPLAY_PREFERENCES_SCRIPT } from "@/lib/display/preferences";
import { BoiteConfirmation } from "@/components/ui/BoiteConfirmation";

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
  metadataBase: new URL(SITE_URL),
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "GODAC",
    title: "GODAC — Carburant, TICPE, flotte, planning et paie pour le transport routier",
    description:
      "Carburant contrôlé au plein près, cuves, écarts et TICPE, puis flotte, planning duplicable, paie transport (IDCC 16) et tournées colis : la gestion de votre entreprise de transport dans un seul outil.",
  },
  title: "GODAC — Carburant, TICPE, flotte, planning et paie pour le transport routier",
  description:
    "Carburant contrôlé au plein près, cuves, écarts et TICPE, puis flotte, planning duplicable, paie transport (IDCC 16) et tournées colis : la gestion de votre entreprise de transport dans un seul outil.",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F7FB" },
    { media: "(prefers-color-scheme: dark)", color: "#070B14" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the inline script sets data-theme /
    // data-text-size on <html> before React hydrates.
    <html lang="fr" className={`${syne.variable} ${dmSans.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_PREFERENCES_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* Boîte de confirmation unique (lib/ui/confirmation.ts › confirmer). */}
        <BoiteConfirmation />
      </body>
    </html>
  );
}
