import Link from "next/link";
import { garderPage } from "@/lib/acces/garde-page";
import { PageHeader, Card, EmptyState, StatTile } from "@/components/ui";
import { AvertissementTicpe } from "@/components/ticpe/AvertissementTicpe";
import { SelecteurPeriode } from "@/components/ticpe/SelecteurPeriode";
import { AnnulerDeclaration, MarquerDeclaree } from "@/components/ticpe/Declarations";
import { calculerTicpe } from "@/lib/ticpe/calcul-serveur";
import { chargerDeclarations } from "@/lib/ticpe/declarations-serveur";
import { controlesDeLaPeriode, periodeDemandee } from "@/lib/ticpe/periode-serveur";
import { compterParGravite } from "@/lib/ticpe/controles";
import { argentNonReclame, estDeclaree, libelleMois, moisDeLaPeriode, periodeContenant, prochaineEcheance, type PeriodeDeclaration } from "@/lib/ticpe/echeances";
import { lignesDeLaPeriode, totaliser } from "@/lib/ticpe/montant";
import { parMois, parVehicule } from "@/lib/ticpe/synthese";
import { formatJour } from "@/lib/ticpe/bareme";
import { LIBELLES_REGIME } from "@/lib/ticpe/reglages";
import { parisDay } from "@/lib/utils/paris-time";

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const litres = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} L`;

/**
 * Tableau de bord TICPE : montant récupérable de la période en cours et
 * de la prochaine échéance (selon le régime de TVA), argent non réclamé
 * (périodes encore réclamables jusqu'au 31/12/N+2), détail par véhicule
 * et par mois, historique des déclarations.
 */
export default async function TicpeTableauDeBordPage({ searchParams }: { searchParams: Promise<{ periode?: string; du?: string; au?: string }> }) {
  const g = await garderPage("carburant.ticpe");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const params = await searchParams;
  const aujourdhui = parisDay();
  const anneeCourante = Number(aujourdhui.slice(0, 4));

  // Années entières : réclamables (N-2, au plus tôt 2025) jusqu'à l'année en cours.
  const anneeDebut = Math.max(2025, anneeCourante - 2);
  const calcul = await calculerTicpe(supabase, appUser.organization_id, { anneeDebut: Math.min(anneeDebut, anneeCourante), anneeFin: anneeCourante });
  const { reglages, migrationManquante } = calcul.parametres;
  const regime = reglages.regime_tva;
  const periode = periodeDemandee(params, reglages, aujourdhui);
  const periodeHorsCalcul = Number(periode.debut.slice(0, 4)) < calcul.annees.debut;
  const calculPeriode = periodeHorsCalcul
    ? await calculerTicpe(supabase, appUser.organization_id, { anneeDebut: Number(periode.debut.slice(0, 4)), anneeFin: Number(periode.fin.slice(0, 4)) })
    : calcul;
  const [{ declarations, disponible: declarationsDisponibles }, { points }] = await Promise.all([
    chargerDeclarations(supabase, appUser.organization_id),
    controlesDeLaPeriode(supabase, appUser.organization_id, periode, calculPeriode),
  ]);

  const montantDe = (p: Pick<PeriodeDeclaration, "debut" | "fin">) => totaliser(lignesDeLaPeriode(calcul.lignes, p.debut, p.fin)).montant;
  const enCours = periodeContenant(aujourdhui, regime);
  const totEnCours = totaliser(lignesDeLaPeriode(calcul.lignes, enCours.debut, enCours.fin));
  const echeance = prochaineEcheance(aujourdhui, reglages);
  const montantEcheance = montantDe(echeance.periode);
  const nonReclame = argentNonReclame(montantDe, declarations, aujourdhui, regime);
  const { bloquants, avertissements } = compterParGravite(points);

  const lignesPeriode = lignesDeLaPeriode(calculPeriode.lignes, periode.debut, periode.fin);
  const totPeriode = totaliser(lignesPeriode);
  const vehicules = [...parVehicule(lignesPeriode).entries()]
    .map(([id, t]) => ({ id, registration: calculPeriode.evalues.get(id)?.vehicule.registration ?? "—", ...t }))
    .sort((a, b) => b.montant - a.montant);
  const mois = parMois(lignesPeriode);
  const declaree = estDeclaree(periode, declarations);
  const peutDeclarer = declarationsDisponibles && ["direction", "comptable"].includes(appUser.role);
  const periodeTerminee = periode.fin < aujourdhui;

  return (
    <div>
      <PageHeader
        title="TICPE : remboursement du gazole"
        description={`Montants préparés à partir des pleins validés, véhicule par véhicule. Régime : ${LIBELLES_REGIME[regime]}.`}
        actions={
          <Link href={`/carburant/ticpe/documents?periode=${encodeURIComponent(periode.cle)}`} className="btn-primary !px-3 !py-1.5 text-sm">
            Documents de la période
          </Link>
        }
      />
      <AvertissementTicpe migrationManquante={migrationManquante} />
      {calcul.tronque && <p className="mb-3 text-sm text-orange-ink">Trop de pleins : montants incomplets.</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={`Période en cours (${enCours.libelle})`} value={euros(totEnCours.montant)} />
        <Link href={`/carburant/ticpe?periode=${encodeURIComponent(echeance.periode.cle)}`} className="block">
          <StatTile
            label={`À déclarer avant le ${formatJour(echeance.dateLimite)} (${echeance.periode.libelle}, J-${echeance.joursRestants})`}
            value={euros(montantEcheance)}
            accent={echeance.joursRestants <= reglages.rappel_jours ? "orange" : "teal"}
          />
        </Link>
        <StatTile label="Argent non réclamé (encore réclamable)" value={euros(nonReclame.total)} accent={nonReclame.total > 0 ? "gold" : "teal"} />
        <Link href={`/carburant/ticpe/controles?periode=${encodeURIComponent(periode.cle)}`} className="block">
          <StatTile label={`À régler (${periode.libelle})`} value={`${bloquants} bloquant(s)`} accent={bloquants > 0 ? "orange" : "teal"} />
        </Link>
      </div>
      <p className="-mt-3 mb-6 text-xs text-navy/55">
        Date limite : celle du dépôt de votre déclaration de TVA ({regime === "annuel_ca12" ? "CA12" : "CA3"}), réglable dans les réglages TICPE — à confirmer par
        l&apos;expert-comptable. {avertissements > 0 ? `${avertissements} avertissement(s) à regarder sur la période affichée.` : ""}
      </p>

      <SelecteurPeriode action="/carburant/ticpe" regime={regime} courante={periode} aujourdhui={aujourdhui} />

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg">{periode.libelle}</h2>
            <p className="text-sm text-navy/70">
              {euros(totPeriode.montant)} récupérables · {litres(totPeriode.litresRetenus)} retenus
              {totPeriode.litresHorsPlafond > 0 ? ` · ${litres(totPeriode.litresHorsPlafond)} au-delà du plafond` : ""}
              {totPeriode.tauxManquants > 0 ? ` · ${totPeriode.tauxManquants} plein(s) sans taux` : ""}
            </p>
          </div>
          {declaree ? (
            <span className="badge-teal">Déclarée</span>
          ) : (
            peutDeclarer &&
            periodeTerminee && <MarquerDeclaree periode={periode} regime={regime} montantCalcule={totPeriode.montant} litres={totPeriode.litresRetenus} aujourdhui={aujourdhui} />
          )}
        </div>

        {vehicules.length === 0 ? (
          <EmptyState title="Aucun plein compté sur la période" description="Seuls les pleins de gazole validés des véhicules éligibles comptent." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="overflow-x-auto lg:col-span-2">
              <h3 className="mb-2 text-base">Par véhicule</h3>
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-navy/60">
                  <tr>
                    <th className="pb-2">Véhicule</th>
                    <th className="pb-2 text-right">Pleins</th>
                    <th className="pb-2 text-right">Litres retenus</th>
                    <th className="pb-2 text-right">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicules.map((v) => (
                    <tr key={v.id} className="border-t border-navy/5">
                      <td className="py-1.5">
                        <Link href={`/carburant/pleins?vehicle=${v.id}&from=${periode.debut}&to=${periode.fin}`} className="text-teal-ink hover:underline">
                          {v.registration}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{v.pleins}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {litres(v.litresRetenus)}
                        {v.litresHorsPlafond > 0 && <span className="block text-xs text-orange-ink">+{litres(v.litresHorsPlafond)} hors plafond</span>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {euros(v.montant)}
                        {v.tauxManquants > 0 && <span className="block text-xs text-orange-ink">{v.tauxManquants} sans taux</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <h3 className="mb-2 text-base">Par mois</h3>
              <table className="w-full text-sm">
                <tbody>
                  {moisDeLaPeriode(periode).map((m) => {
                    const t = mois.get(m);
                    return (
                      <tr key={m} className="border-t border-navy/5">
                        <td className="py-1.5 first-letter:uppercase">{libelleMois(m)}</td>
                        <td className="py-1.5 text-right tabular-nums">{t ? litres(t.litresRetenus) : "—"}</td>
                        <td className="py-1.5 text-right tabular-nums">{t ? euros(t.montant) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-lg">Argent non réclamé</h2>
          <p className="mb-3 text-xs text-navy/60">
            Périodes terminées, non marquées déclarées. Les consommations d&apos;une année sont réclamables jusqu&apos;au 31 décembre de la deuxième année
            suivante (2026 → 31/12/2028).
          </p>
          {nonReclame.periodes.length === 0 ? (
            <p className="text-sm text-navy/60">Rien en attente.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-navy/5 text-sm">
              {nonReclame.periodes
                .slice()
                .reverse()
                .map((x) => (
                  <li key={x.periode.cle} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/carburant/ticpe?periode=${encodeURIComponent(x.periode.cle)}`} className="text-teal-ink hover:underline first-letter:uppercase">
                        {x.periode.libelle}
                      </Link>
                      <span className="tabular-nums">
                        <span className="font-semibold">{euros(x.montant)}</span>
                        <span className="text-xs text-navy/55"> · jusqu&apos;au {formatJour(x.dateLimiteReclamation)}</span>
                      </span>
                    </div>
                    {peutDeclarer && (
                      <MarquerDeclaree
                        periode={x.periode}
                        regime={regime}
                        montantCalcule={x.montant}
                        litres={totaliser(lignesDeLaPeriode(calcul.lignes, x.periode.debut, x.periode.fin)).litresRetenus}
                        aujourdhui={aujourdhui}
                      />
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-1 text-lg">Déclarations</h2>
          <p className="mb-3 text-xs text-navy/60">Une période marquée déclarée ne compte plus dans l&apos;argent non réclamé.</p>
          {!declarationsDisponibles ? (
            <p className="text-sm text-navy/60">Historique disponible après la prochaine mise à jour de la base.</p>
          ) : declarations.length === 0 ? (
            <p className="text-sm text-navy/60">Aucune déclaration marquée.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-navy/5 text-sm">
              {declarations.map((d) => (
                <li key={d.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${d.annulee_le ? "text-navy/45 line-through" : ""}`}>
                  <span className="first-letter:uppercase">
                    {d.periode_libelle ?? d.periode_cle} · déclarée le {formatJour(d.declaree_le)}
                    {d.montant_calcule !== null && Math.abs(d.montant_calcule - d.montant) >= 0.01 ? ` (calculé : ${euros(d.montant_calcule)})` : ""}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {euros(d.montant)}
                    {!d.annulee_le && peutDeclarer && <AnnulerDeclaration id={d.id} libelle={d.periode_libelle ?? d.periode_cle} />}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
