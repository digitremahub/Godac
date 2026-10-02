import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

export default function MentionsLegalesPage() {
  return (
    <LegalPageLayout title="Mentions légales">
      <p>
        Le site et l&apos;application GODAC sont édités par [À COMPLÉTER : raison sociale], [À COMPLÉTER : forme
        juridique], au capital de [À COMPLÉTER : montant] euros, immatriculée au RCS de [À COMPLÉTER : ville] sous le
        numéro SIRET [À COMPLÉTER : numéro SIRET], dont le siège social est situé [À COMPLÉTER : adresse].
      </p>
      <p>
        Numéro de TVA intracommunautaire : [À COMPLÉTER].
        <br />
        Directeur de la publication : [À COMPLÉTER : nom].
        <br />
        Contact : [À COMPLÉTER : adresse email ou téléphone].
      </p>
      <p>
        Hébergement : le site et l&apos;application sont hébergés par [À COMPLÉTER : hébergeur, ex. Vercel Inc.],
        [À COMPLÉTER : adresse de l&apos;hébergeur]. La base de données est hébergée par Supabase (Supabase Inc.).
      </p>
      <p>
        Le présent document est un modèle à compléter avant toute mise en production — il ne constitue pas des
        mentions légales valides en l&apos;état.
      </p>
    </LegalPageLayout>
  );
}
