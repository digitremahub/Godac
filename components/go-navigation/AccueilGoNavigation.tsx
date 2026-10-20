import "server-only";
import Link from "next/link";
import { etatModulesCourant } from "@/lib/acces/modules-requete";
import { joursRestants, PLAFONDS_ESSAI } from "@/lib/go-navigation/offre";

const nf = new Intl.NumberFormat("fr-FR");

/**
 * Accueil des comptes d'essai GO Navigation, en tête de Tournée colis :
 * jours d'essai restants, les trois étapes et l'accès direct à la
 * navigation chauffeur.
 */
export async function AccueilGoNavigation({ organizationId }: { organizationId: string }) {
  const { offre } = await etatModulesCourant(organizationId);
  const jours = joursRestants(offre.trialEndsAt);
  const plafond = (f: string) => nf.format(PLAFONDS_ESSAI.find((p) => p.feature === f)?.included_per_month ?? 0);
  return (
    <section className="mb-5 rounded-2xl border border-teal/30 bg-teal/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-navy">Bienvenue sur GO Navigation</h2>
          <p className="mt-1 text-sm text-navy/70">
            Essai gratuit : {jours > 1 ? `${jours} jours restants` : jours === 1 ? "dernier jour" : "terminé"}.
          </p>
        </div>
        <Link href="/livreur/navigation" className="btn-primary">
          Ouvrir GO Navigation
        </Link>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-navy/80">
        <li>Créez votre tournée ci-dessous (« Nouvelle tournée »).</li>
        <li>Ajoutez vos colis : scan du code-barres, photo de l&apos;étiquette ou saisie de l&apos;adresse.</li>
        <li>Optimisez l&apos;ordre de passage, puis lancez la navigation.</li>
      </ol>
      <p className="mt-3 text-xs text-navy/60">
        Pendant l&apos;essai : {plafond("ocr_label")} lectures d&apos;étiquettes par photo et {plafond("route_optimization")} optimisations de tournée par mois. Les scans de codes-barres sont illimités.
      </p>
    </section>
  );
}
