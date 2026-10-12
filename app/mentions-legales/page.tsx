import Link from "next/link";
import { LegalPageLayout } from "@/components/legal/LegalPageLayout";

export default function MentionsLegalesPage() {
  return (
    <LegalPageLayout title="Mentions légales">
      <p>
        <strong>Éditeur.</strong> Le site et l&apos;application GODAC sont édités à titre individuel par François.
        <br />
        Directeur de la publication : François.
        <br />
        Contact : <a href="mailto:contact@godac.fr" className="text-teal-ink hover:underline">contact@godac.fr</a>
      </p>
      <p>
        <strong>Hébergement du site et de l&apos;application.</strong> Vercel Inc., 440 N Barranca Ave #4133, Covina,
        CA 91723, États-Unis — vercel.com. Les traitements serveur sont exécutés dans la région de Paris (France).
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
        <strong>Données personnelles.</strong> Le traitement des données est décrit dans la{" "}
        <Link href="/confidentialite" className="text-teal-ink hover:underline">
          politique de confidentialité
        </Link>
        .
      </p>
    </LegalPageLayout>
  );
}
