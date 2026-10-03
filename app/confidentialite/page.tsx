import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

export default function ConfidentialitePage() {
  return (
    <LegalPageLayout title="Politique de confidentialité">
      <p>
        [À COMPLÉTER : raison sociale] (ci-après « nous ») attache une attention particulière à la protection des
        données personnelles traitées dans le cadre de l&apos;application GODAC, conformément au Règlement Général
        sur la Protection des Données (RGPD).
      </p>
      <p>
        <strong>Données collectées.</strong> Dans le cadre de son utilisation, GODAC traite notamment : identité et
        coordonnées des utilisateurs (nom, email, téléphone), données liées à l&apos;activité professionnelle
        (tournées, ravitaillements, kilométrage, photos de compteurs/tickets/véhicules), et données techniques de
        connexion. [À COMPLÉTER : liste exhaustive le cas échéant].
      </p>
      <p>
        <strong>Finalités.</strong> Ces données sont traitées pour permettre le fonctionnement du service : gestion
        du carburant et de la flotte, suivi des tournées, alertes de gestion, facturation. [À COMPLÉTER].
      </p>
      <p>
        <strong>Hébergement et sous-traitants.</strong> Les données sont hébergées par Supabase (Supabase Inc.) et
        l&apos;application par [À COMPLÉTER : hébergeur]. Des prestataires tiers peuvent être utilisés pour certaines
        fonctionnalités optionnelles (lecture automatique de documents, envoi d&apos;emails, paiement). [À COMPLÉTER :
        liste des sous-traitants effectivement activés].
      </p>
      <p>
        <strong>Durée de conservation.</strong> [À COMPLÉTER].
      </p>
      <p>
        <strong>Droits des personnes.</strong> Conformément au RGPD, toute personne dispose d&apos;un droit
        d&apos;accès, de rectification, d&apos;effacement et de portabilité de ses données, ainsi que d&apos;un droit
        d&apos;opposition. Pour exercer ces droits : [À COMPLÉTER : adresse email ou procédure de contact].
      </p>
      <p>
        Le présent document est un modèle à compléter et à faire valider par un professionnel du droit avant toute
        mise en production.
      </p>
    </LegalPageLayout>
  );
}
