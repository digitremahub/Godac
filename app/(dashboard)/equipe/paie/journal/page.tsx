import { garderPage } from "@/lib/acces/garde-page";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { NavigationMois } from "@/components/paie/NavigationMois";
import { BadgeValidation } from "@/components/paie/ValidationBulletins";
import { moisValide } from "@/lib/paie/donnees";
import { donneesMois } from "@/lib/paie/export-serveur";
import { RUBRIQUES, type LigneJournal, type TotauxJournal } from "@/lib/paie/journal";
import { currentMonth } from "@/lib/planning/dates";

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Montants({ l }: { l: Omit<LigneJournal, "userId" | "nom" | "matricule" | "statut"> | TotauxJournal }) {
  return (
    <>
      <td className="px-2 py-1.5 text-right">{eur(l.brut)}</td>
      {RUBRIQUES.map((r) => (
        <td key={r.id} className="px-2 py-1.5 text-right">
          {eur(l.rubriques[r.id].salarial)}
          <span className="block text-navy/55">{eur(l.rubriques[r.id].patronal)}</span>
        </td>
      ))}
      <td className="px-2 py-1.5 text-right">{eur(l.totalSalarial)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.totalPatronal)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.netSocial)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.netImposable)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.montantPas)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.frais)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.retenues)}</td>
      <td className="px-2 py-1.5 text-right font-semibold">{eur(l.netPaye)}</td>
      <td className="px-2 py-1.5 text-right">{eur(l.coutTotal)}</td>
    </>
  );
}

/** Équipe › Paie › Journal : le mois par salarié et par rubrique, totaux de l'entreprise, export PDF. */
export default async function JournalPaiePage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const g = await garderPage("equipe.paie_journal");
  if (!g.ok) return g.ecran;
  const params = await searchParams;
  const mois = moisValide(params.mois) ? params.mois : currentMonth();
  const d = await donneesMois(g.supabase, mois);
  const t = d.totaux;

  return (
    <div>
      <PageHeader
        title="Journal de paie"
        description="Tous les bulletins calculés du mois, par rubrique de cotisations, avec les totaux de l'entreprise."
        actions={
          d.journal.length > 0 ? (
            <a href={`/api/paie/export?mois=${mois}&format=journal`} className="btn-primary !py-2 text-sm">
              Télécharger le PDF
            </a>
          ) : undefined
        }
      />
      <NavigationMois base="/equipe/paie/journal" mois={mois} libelle={d.libelle} />

      {d.journal.length === 0 ? (
        <EmptyState title="Aucun bulletin calculé ce mois-ci." description="Les bulletins se préparent dans Équipe › Paie › Bulletins du mois." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Masse salariale brute", t.brut],
              ["Cotisations salariales", t.totalSalarial],
              ["Charges patronales", t.totalPatronal],
              ["Dont réduction générale", -t.reductionGenerale],
              ["Nets payés", t.netPaye],
              ["Coût total employeur", t.coutTotal],
            ].map(([l, v]) => (
              <Card key={l as string} className="!py-3">
                <p className="text-xs text-navy/60">{l}</p>
                <p className="font-display text-lg font-bold tabular-nums">{eur(v as number)} €</p>
              </Card>
            ))}
          </div>
          {t.nonValides > 0 && (
            <p className="mb-4 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
              {t.nonValides} bulletin{t.nonValides > 1 ? "s" : ""} non validé{t.nonValides > 1 ? "s" : ""} : ce journal est provisoire.
            </p>
          )}
          <Card className="!p-0 overflow-x-auto">
            <table className="w-full min-w-[1200px] text-xs tabular-nums">
              <caption className="sr-only">Journal de paie de {d.libelle}</caption>
              <thead className="bg-navy text-left text-white">
                <tr>
                  <th scope="col" className="px-2 py-2">Salarié</th>
                  <th scope="col" className="px-2 py-2 text-right">Brut</th>
                  {RUBRIQUES.map((r) => (
                    <th key={r.id} scope="col" className="px-2 py-2 text-right">
                      {r.libelle}
                      <span className="block font-normal opacity-70">sal. / pat.</span>
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-right">Total sal.</th>
                  <th scope="col" className="px-2 py-2 text-right">Total pat.</th>
                  <th scope="col" className="px-2 py-2 text-right">Net social</th>
                  <th scope="col" className="px-2 py-2 text-right">Net imposable</th>
                  <th scope="col" className="px-2 py-2 text-right">PAS</th>
                  <th scope="col" className="px-2 py-2 text-right">Frais</th>
                  <th scope="col" className="px-2 py-2 text-right">Retenues</th>
                  <th scope="col" className="px-2 py-2 text-right">Net payé</th>
                  <th scope="col" className="px-2 py-2 text-right">Coût total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/[0.07]">
                {d.journal.map((l) => (
                  <tr key={l.userId}>
                    <th scope="row" className="px-2 py-1.5 text-left font-semibold">
                      {l.nom}
                      {l.statut !== "valide" && (
                        <span className="mt-0.5 block">
                          <BadgeValidation statut={l.statut} />
                        </span>
                      )}
                    </th>
                    <Montants l={l} />
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-navy bg-navy/[0.04] font-semibold">
                <tr>
                  <th scope="row" className="px-2 py-2 text-left">
                    Total ({t.effectif})
                  </th>
                  <Montants l={t} />
                </tr>
              </tfoot>
            </table>
          </Card>
          <p className="mt-3 text-xs text-navy/60">
            Par rubrique : part salariale, puis part patronale en dessous. Coût total = brut + charges patronales + indemnités de frais.
          </p>
        </>
      )}
    </div>
  );
}
