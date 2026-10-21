import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { champsManquants, estSorti, libelleContrat, partiesRegistre, SEXES, titreTravail, type EntreeRegistre } from "@/lib/registre/personnel";
import { lireRegistre } from "@/lib/registre/serveur";
import { dateFr } from "@/lib/paie/csv";

function Lignes({ entrees, aujourdhui, prefixe }: { entrees: EntreeRegistre[]; aujourdhui: string; prefixe: string }) {
  return (
    <>
      {entrees.map((e, i) => {
        const manque = champsManquants(e);
        return (
          <tr key={e.userId} className={estSorti(e, aujourdhui) ? "text-navy/60" : undefined}>
            <td className="px-2 py-2 tabular-nums">{`${prefixe}${i + 1}`}</td>
            <th scope="row" className="px-2 py-2 text-left font-semibold">
              <Link href={`/equipe/utilisateurs/${e.userId}#registre`} className="hover:underline">
                {e.nom ?? e.nomAffiche}
              </Link>
              {manque.length > 0 && <span className="mt-0.5 block text-xs font-normal text-orange-ink">À compléter : {manque.join(", ")}</span>}
            </th>
            <td className="px-2 py-2">{e.prenoms ?? ""}</td>
            <td className="px-2 py-2">{e.nationalite ?? ""}</td>
            <td className="px-2 py-2 tabular-nums">{dateFr(e.dateNaissance)}</td>
            <td className="px-2 py-2">{e.sexe ? SEXES[e.sexe] : ""}</td>
            <td className="px-2 py-2">{e.emploi ?? ""}</td>
            <td className="px-2 py-2">{e.qualification ?? ""}</td>
            <td className="px-2 py-2 tabular-nums">{dateFr(e.dateEntree)}</td>
            <td className="px-2 py-2 tabular-nums">{dateFr(e.dateSortie)}</td>
            <td className="px-2 py-2">{libelleContrat(e)}</td>
            <td className="px-2 py-2">{titreTravail(e)}</td>
          </tr>
        );
      })}
    </>
  );
}

/**
 * Équipe › Registre du personnel (direction) : registre unique du
 * personnel (art. L1221-13 et D1221-23), dans l'ordre des embauches, avec
 * les fiches incomplètes signalées. Les mentions se complètent dans la
 * fiche de chaque salarié (encadré « Registre du personnel »).
 */
export default async function RegistrePage() {
  const g = await garderPage("equipe.registre");
  if (!g.ok) return g.ecran;
  const { entrees, exclus } = await lireRegistre(g.supabase);
  const { salaries, stagiaires } = partiesRegistre(entrees);
  const incomplets = entrees.filter((e) => champsManquants(e).length > 0);
  const aujourdhui = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

  return (
    <div>
      <PageHeader
        title="Registre unique du personnel"
        description="Obligatoire dans chaque établissement : tous les salariés, dans l'ordre des embauches, avec leurs mentions légales. À présenter à l'inspection du travail sur demande."
        actions={
          <>
            <a href="/api/paie/registre?format=pdf" className="btn-primary !py-2 text-sm">
              PDF
            </a>
            <a href="/api/paie/registre?format=csv" className="btn-secondary !py-2 text-sm">
              CSV
            </a>
          </>
        }
      />

      {incomplets.length > 0 && (
        <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
          <strong>
            {incomplets.length} fiche{incomplets.length > 1 ? "s" : ""} incomplète{incomplets.length > 1 ? "s" : ""}
          </strong>{" "}
          : cliquez sur le nom pour compléter les mentions manquantes.
        </div>
      )}

      {entrees.length === 0 ? (
        <EmptyState title="Aucun salarié inscrit." />
      ) : (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <caption className="sr-only">Registre unique du personnel</caption>
            <thead className="bg-navy text-left text-xs text-white">
              <tr>
                {["N°", "Nom", "Prénoms", "Nationalité", "Naissance", "Sexe", "Emploi", "Qualification", "Entrée", "Sortie", "Contrat", "Titre de travail"].map((t) => (
                  <th key={t} scope="col" className="px-2 py-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/[0.07]">
              <Lignes entrees={salaries} aujourdhui={aujourdhui} prefixe="" />
              {stagiaires.length > 0 && (
                <tr className="bg-navy/[0.04]">
                  <td colSpan={12} className="px-2 py-2 text-xs font-semibold uppercase tracking-wide text-navy/70">
                    Stagiaires (partie distincte)
                  </td>
                </tr>
              )}
              <Lignes entrees={stagiaires} aujourdhui={aujourdhui} prefixe="S" />
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-xs text-navy/60">
        Les mentions sont à conserver 5 ans après le départ de chaque salarié : exportez le registre (PDF) régulièrement et à chaque départ. Nationalité
        et titre de travail ne sont visibles que de la direction et du salarié concerné.
      </p>
      {exclus.length > 0 && (
        <p className="mt-2 text-xs text-navy/60">
          Comptes hors registre (non salariés) : {exclus.map((e, i) => (
            <span key={e.userId}>
              {i > 0 && ", "}
              <Link href={`/equipe/utilisateurs/${e.userId}#registre`} className="underline">
                {e.nom}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
