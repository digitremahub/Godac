import type { Metadata } from "next";
import { Syne, Inter } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { frFR } from "@clerk/localizations";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-syne",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GODAC — Gestion et Optimisation Des Assets et Carburant",
  description:
    "L'OS de backoffice pour les entreprises de transport routier de marchandises : carburant, flotte, RH, planning et conformité.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider localization={frFR}>
      <html lang="fr" className={`${syne.variable} ${inter.variable}`}>
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
