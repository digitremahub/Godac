import Link from "next/link";
import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { AvertissementTicpe } from "@/components/ticpe/AvertissementTicpe";
import { SelecteurPeriode } from "@/components/ticpe/SelecteurPeriode";
import { chargerParametresTicpe } from "@/lib/ticpe/serveur";
import { controlesDeLaPeriode, periodeDemandee } from "@/lib/ticpe/periode-serveur";
import { compterParGravite } from "@/lib/ticpe/controles";
import { parisDay } from "@/lib/utils/paris-time";

/**
 * Contrôles avant déclaration : tout ce qui est à régler sur la période
 * (bloquant / avertissement), chaque ligne menant à l'objet à corriger.
 */
export default async function ControlesTicpePage({ searchParams }: { searchParams: Promise<{ periode?: string; du?: string; au?: string }> }) {
  const g = await garderPage("carburant.ticpe_controles");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const params = await searchParams;
  const aujourdhui = parisDay();
  const p = await chargerParametresTicpe(supabase, appUser.organization_id);
  const periode = periodeDemandee(params, p.reglages, aujourdhui);
  const { points, calcul } = await controlesDeLaPeriode(supabase, appUser.organization_id, periode);
  const { bloquants, avertissements } = compterParGravite(points);

  return (
    <div>
      <PageHeader
        title="TICPE : à régler avant de déclarer"
        description="Les points bloquants faussent le montant ou ne tiendraient pas à un contrôle : corrigez-les avant la déclaration. Les avertissements sont à regarder."
      />
      <AvertissementTicpe migrationManquante={p.migrationManquante} />
      <SelecteurPeriode action="/carburant/ticpe/controles" regime={p.reglages.regime_tva} courante={periode} aujourdhui={aujourdhui} />
      {calcul.tronque && <p className="mb-3 text-sm text-orange-ink">Trop de pleins sur la période : contrôle incomplet.</p>}
      <p className="mb-4 text-sm text-navy/70">
        {periode.libelle} : <span className="font-semibold text-orange-ink">{bloquants} bloquant(s)</span> · {avertissements} avertissement(s).
      </p>
      {points.length === 0 ? (
        <EmptyState title="Rien à régler" description="Aucun point bloquant ni avertissement sur cette période." />
      ) : (
        <Card className="overflow-x-auto">
          <ul className="flex flex-col divide-y divide-navy/5">
            {points.map((pt) => (
              <li key={pt.cle}>
                <Link href={pt.lien} className="flex flex-wrap items-start gap-3 py-2.5 hover:bg-navy/[0.02]">
                  <span className={pt.gravite === "bloquant" ? "badge-orange" : "badge-gold"}>{pt.gravite === "bloquant" ? "Bloquant" : "Avertissement"}</span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-medium text-navy">{pt.titre}</span>
                    <span className="block text-navy/70">{pt.detail}</span>
                  </span>
                  <span className="text-xs text-teal-ink">Corriger →</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
