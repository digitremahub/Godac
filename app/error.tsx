"use client";

import { EcranErreur } from "@/components/shared/EcranErreur";

/** Filet de sécurité des pages publiques et de la racine (l'espace connecté a le sien dans app/(dashboard)/error.tsx). */
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <EcranErreur error={error} reset={reset} origine="racine" retour={{ href: "/", libelle: "Retour à l'accueil" }} />;
}
