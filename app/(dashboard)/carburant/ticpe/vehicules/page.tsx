import Link from "next/link";
import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { AvertissementTicpe } from "@/components/ticpe/AvertissementTicpe";
import { BadgeEligibilite } from "@/components/ticpe/BadgeEligibilite";
import { chargerParametresTicpe } from "@/lib/ticpe/serveur";
import { evaluerFlotte } from "@/lib/ticpe/vehicules-serveur";
import { aRegulariser } from "@/lib/ticpe/eligibilite";
import { LIBELLES_CATEGORIE_COURTS, formatJour } from "@/lib/ticpe/bareme";

/**
 * Éligibilité TICPE de chaque véhicule : ✅ / ⚠️ / ❌ avec les raisons
 * et la période. Par défaut : les véhicules à régulariser.
 */
export default async function VehiculesTicpePage({ searchParams }: { searchParams: Promise<{ filtre?: string }> }) {
  const g = await garderPage("carburant.ticpe_vehicules");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const { filtre } = await searchParams;
  const p = await chargerParametresTicpe(supabase, appUser.organization_id);
  const { evalues } = await evaluerFlotte(supabase, p.reglages);
  const tous = [...evalues.values()];
  const aReg = tous.filter((e) => aRegulariser(e.eligibilite));
  const legers = tous.filter((e) => e.eligibilite.raisons.some((r) => r.code === "vehicule_leger"));
  const voirTout = filtre === "tous";
  const liste = (voirTout ? tous.filter((e) => !e.eligibilite.raisons.some((r) => r.code === "vehicule_leger")) : aReg).sort(
    (a, b) => a.vehicule.registration.localeCompare(b.vehicule.registration, "fr"),
  );
  const compte = (s: string) => tous.filter((e) => e.eligibilite.statut === s).length;

  return (
    <div>
      <PageHeader
        title="Véhicules et TICPE"
        description="Pour chaque véhicule : éligible, à vérifier (compté, un point reste à régler) ou exclu, avec la raison et la période prise en compte."
      />
      <AvertissementTicpe migrationManquante={p.migrationManquante} />
      <p className="mb-4 text-sm text-navy/70">
        ✅ {compte("eligible")} éligible(s) · ⚠️ {compte("a_verifier")} à vérifier · ❌ {compte("exclu")} exclu(s), dont {legers.length} véhicule(s) léger(s).
      </p>
      <div className="mb-4 flex gap-2 text-sm">
        <Link href="/carburant/ticpe/vehicules" className={voirTout ? "btn-ghost !px-3 !py-1.5" : "btn-primary !px-3 !py-1.5"}>
          À régulariser ({aReg.length})
        </Link>
        <Link href="/carburant/ticpe/vehicules?filtre=tous" className={voirTout ? "btn-primary !px-3 !py-1.5" : "btn-ghost !px-3 !py-1.5"}>
          Tous les poids lourds
        </Link>
      </div>
      {liste.length === 0 ? (
        <EmptyState title={voirTout ? "Aucun poids lourd" : "Rien à régulariser"} description={voirTout ? undefined : "Tous les véhicules concernés sont en règle."} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-navy/60">
              <tr>
                <th className="pb-2">Véhicule</th>
                <th className="pb-2">Statut</th>
                <th className="pb-2">Raisons</th>
                <th className="pb-2">Période</th>
              </tr>
            </thead>
            <tbody>
              {liste.map(({ vehicule: v, eligibilite: e }) => (
                <tr key={v.id} className="border-t border-navy/5 align-top">
                  <td className="py-2">
                    <Link href={`/flotte/vehicules/${v.id}`} className="font-medium text-teal-ink hover:underline">
                      {v.registration}
                    </Link>
                    <p className="text-xs text-navy/60">
                      {v.type}
                      {v.ptac_kg ? ` · ${Number(v.ptac_kg).toLocaleString("fr-FR")} kg` : ""}
                      {e.categorie ? ` · ${LIBELLES_CATEGORIE_COURTS[e.categorie]}` : ""}
                    </p>
                  </td>
                  <td className="py-2">
                    <BadgeEligibilite statut={e.statut} prefixe="" />
                  </td>
                  <td className="py-2">
                    {e.raisons.length === 0 ? (
                      <span className="text-navy/55">—</span>
                    ) : (
                      <ul className="flex flex-col gap-0.5">
                        {e.raisons.map((r) => (
                          <li key={r.code} className={r.gravite === "exclu" ? "text-orange-ink" : r.gravite === "a_verifier" ? "text-gold-ink" : "text-navy/65"}>
                            {r.libelle}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-2 text-navy/70">
                    {e.periode.debut || e.periode.fin
                      ? `${e.periode.debut ? formatJour(e.periode.debut) : "…"} → ${e.periode.fin ? formatJour(e.periode.fin) : "…"}`
                      : "Toute la période"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
