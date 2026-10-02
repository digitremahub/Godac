import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

export default function CguPage() {
  return (
    <LegalPageLayout title="Conditions générales d'utilisation">
      <p>
        Les présentes conditions générales d&apos;utilisation (CGU) régissent l&apos;accès et l&apos;utilisation de
        l&apos;application GODAC, éditée par [À COMPLÉTER : raison sociale], par les entreprises clientes (ci-après
        « l&apos;Organisation ») et leurs utilisateurs.
      </p>
      <p>
        <strong>Objet.</strong> GODAC est un outil de gestion du carburant, de la flotte, des tournées et de
        l&apos;entretien destiné aux entreprises de transport routier de marchandises. [À COMPLÉTER : description
        détaillée du service et des modules inclus selon l&apos;offre souscrite].
      </p>
      <p>
        <strong>Compte et accès.</strong> Chaque utilisateur accède à l&apos;application via un compte nominatif
        rattaché à l&apos;Organisation. [À COMPLÉTER : conditions de création de compte, rôles, responsabilité de
        l&apos;Organisation sur la gestion de ses utilisateurs].
      </p>
      <p>
        <strong>Abonnement et tarification.</strong> [À COMPLÉTER : conditions tarifaires, durée d&apos;engagement,
        modalités de résiliation — voir la page /modules pour le détail des modules et de leurs prix].
      </p>
      <p>
        <strong>Responsabilité.</strong> [À COMPLÉTER : limites de responsabilité, disponibilité du service,
        maintenance].
      </p>
      <p>
        <strong>Droit applicable.</strong> [À COMPLÉTER : droit applicable et juridiction compétente].
      </p>
      <p>
        Le présent document est un modèle à compléter et à faire valider par un professionnel du droit avant toute
        mise en production.
      </p>
    </LegalPageLayout>
  );
}
