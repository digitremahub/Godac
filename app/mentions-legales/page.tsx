import Link from "next/link";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";
import { EDITEUR, designationEditeur } from "@/lib/legal/editeur";

export default function MentionsLegalesPage() {
  return (
    <LegalPageLayout title="Mentions légales">
      <p>
        <strong>Éditeur.</strong>{" "}
        {EDITEUR.societe
          ? `Le site et l’application GODAC sont édités par ${designationEditeur()}.`
          : `Le site et l’application GODAC sont édités à titre individuel par ${EDITEUR.prenom} (société en cours d’immatriculation).`}
        <br />
        Directeur de la publication : {EDITEUR.societe?.representant ?? EDITEUR.prenom}.
        <br />
        Contact : <a href="mailto:contact@godac.fr" className="text-teal-ink hover:underline">contact@godac.fr</a>
      </p>
      <p>
        <strong>Hébergement du site et de l&apos;application.</strong> Vercel Inc., 440 N Barranca Ave #4133, Covina,
        CA 91723, États-Unis — vercel.com. Les fonctions serveur sont exécutées dans la région de Paris (France).
      </p>
      <p>
        <strong>Hébergement des données.</strong> Supabase, 970 Toa Payoh North #07-04, Singapour 318992 —
        supabase.com. La base de données et les fichiers sont stockés sur des serveurs situés à Paris (France).
      </p>
      <p>
        <strong>Propriété intellectuelle.</strong> La marque GODAC, son logo, les textes, visuels et le logiciel sont
        protégés. Toute reproduction ou réutilisation, totale ou partielle, sans autorisation écrite préalable est
        interdite.
      </p>
      <p>
        <strong>Cartes.</strong> Fonds de carte © contributeurs OpenStreetMap (licence ODbL) et OpenFreeMap.
      </p>
      <p>
        <strong>Nature du service.</strong> GODAC est un outil d&apos;organisation et de gain de temps destiné aux entreprises. Il ne
        fournit aucun conseil juridique, fiscal, comptable ou social : les calculs (paie, TICPE, carburant, congés, heures) sont
        indicatifs et restent à vérifier par l&apos;entreprise avec son expert-comptable ou son responsable paie.
      </p>
      <p>
        <strong>Données personnelles.</strong> Le traitement des données est décrit dans la{" "}
        <Link href="/confidentialite" className="text-teal-ink hover:underline">
          politique de confidentialité
        </Link>
        .
      </p>
    </LegalPageLayout>
  );
}
