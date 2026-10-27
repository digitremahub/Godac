"use client";

import { EcranErreur } from "@/components/shared/EcranErreur";

/** Plantage de l'app chauffeur : message clair, « Réessayer », et rassurance sur la file hors ligne (elle reste sur le téléphone). */
export default function Erreur({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EcranErreur
      error={error}
      reset={reset}
      origine="livreur"
      precision="Vos livraisons déjà enregistrées sur le téléphone sont conservées et seront envoyées dès que possible."
      retour={{ href: "/livreur", libelle: "Retour à ma tournée" }}
    />
  );
}
