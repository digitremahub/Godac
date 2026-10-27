import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { PreparerPaieLot } from "@/components/paie/PreparerPaieLot";
import { BadgeValidation } from "@/components/paie/ValidationBulletins";
import { EmptyState, PageHeader, Card } from "@/components/ui";
import { paieIndisponible, paysOrganisation } from "@/lib/pays/serveur";
import { moisValide } from "@/lib/paie/donnees";
import { LIBELLE_ANOMALIE, LIBELLE_STATUT_PREPARATION, SEUIL_VARIATION_NET_POURCENT, type Ecart, type LigneComparaison } from "@/lib/paie/lot";
import { chargerPaieDuMois } from "@/lib/paie/lot-serveur";
import { addMonths, currentMonth } from "@/lib/planning/dates";

const eur = (n: number | null) => (n === null ? "—" : n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }));
const heures = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`);
const signe = (n: number | null, unite: "eur" | "h") => (n === null ? "—" : `${n > 0 ? "+" : ""}${unite === "eur" ? eur(n) : heures(n)}`);
const pourcent = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);

function Cellule({ titre, valeur, precedent }: { titre: string; valeur: string; precedent?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-navy/55 md:hidden">{titre}</p>
      <p className="truncate text-sm tabular-nums">{valeur}</p>
      {precedent && <p className="truncate text-[11px] text-navy/55 tabular-nums">avant : {precedent}</p>}
    </div>
  );
}

function Ligne({ l, mois }: { l: LigneComparaison; mois: string }) {
  const ecartNet = l.net.pourcent !== null && Math.abs(l.net.pourcent) > SEUIL_VARIATION_NET_POURCENT;
  const colonne = (e: Ecart, unite: "eur" | "h") => ({
    valeur: unite === "eur" ? eur(e.courant) : heures(e.courant),
    precedent: unite === "eur" ? eur(e.precedent) : heures(e.precedent),
  });
  const net = colonne(l.net, "eur");
  const hrs = colonne(l.heures, "h");
  const prm = colonne(l.primes, "eur");
  return (
    <li className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-navy/5 px-4 py-3 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,1fr))] md:items-center md:gap-y-0">
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 md:col-span-1 md:block">
        <Link href={`/equipe/paie/${l.userId}?mois=${mois}`} className="font-semibold underline-offset-2 hover:underline">
          {l.nom}
        </Link>
        <span className="md:mt-0.5 md:block">
          {l.statut === "valide" ? <BadgeValidation statut="valide" /> : l.statut === "prepare" ? <BadgeValidation statut="en_attente" /> : <span className="badge-neutral">{LIBELLE_STATUT_PREPARATION.a_preparer}</span>}
        </span>
      </div>
      <Cellule titre="Net" valeur={net.valeur} precedent={net.precedent} />
      <Cellule titre="Écart net" valeur={`${signe(l.net.ecart, "eur")} · ${pourcent(l.net.pourcent)}`} />
      <Cellule titre="Heures" valeur={hrs.valeur} precedent={hrs.precedent} />
      <Cellule titre="Écart heures" valeur={`${signe(l.heures.ecart, "h")} · ${pourcent(l.heures.pourcent)}`} />
      <Cellule titre="Primes" valeur={prm.valeur} precedent={prm.precedent} />
      <Cellule titre="Écart primes" valeur={`${signe(l.primes.ecart, "eur")} · ${pourcent(l.primes.pourcent)}`} />
      {ecartNet && <span className="sr-only">Variation du net supérieure à {SEUIL_VARIATION_NET_POURCENT} %</span>}
    </li>
  );
}

/**
 * Préparer la paie du mois : tous les salariés avec leur statut (à préparer /
 * préparé / validé), préparation de tous les bulletins en un clic, comparaison
 * au mois précédent (net, heures, primes, en valeur et en %) et anomalies à
 * relire avant la validation. Direction et comptable ; la validation reste à la
 * direction.
 */
export default async function PreparerPaiePage({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const g = await garderPage("equipe.paie_preparer");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const pays = await paysOrganisation(supabase, appUser.organization_id);
  if (!pays.paie.moteur) return <EmptyState title={`Paie : ${pays.drapeau} ${pays.nom}`} description={paieIndisponible(pays)} />;
  const params = await searchParams;
  const mois = moisValide(params.mois) ? params.mois : currentMonth();
  const situation = await chargerPaieDuMois(supabase, appUser.organization_id, mois);
  const label = new Date(`${mois}-01T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  const nomsAvecLien = new Map(situation.lignes.map((l) => [l.userId, l.nom]));
  const bloquantes = situation.anomalies.filter((a) => a.gravite === "bloquante");
  const aVerifier = situation.anomalies.filter((a) => a.gravite === "a_verifier");

  return (
    <div>
      <PageHeader title="Préparer la paie du mois" description="Préparez tous les bulletins en un clic, comparez au mois précédent et relisez les anomalies avant la validation par la direction." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/equipe/paie/preparer?mois=${addMonths(mois, -1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          ← Préc.
        </Link>
        <span className="text-sm font-semibold capitalize">{label}</span>
        <Link href={`/equipe/paie/preparer?mois=${addMonths(mois, 1)}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Suiv. →
        </Link>
        <Link href={`/equipe/paie?mois=${mois}`} className="btn-secondary !px-3 !py-1.5 text-sm">
          Bulletin par bulletin
        </Link>
      </div>

      <div className="mb-5 grid grid-cols-3 gap-3">
        {(
          [
            ["À préparer", situation.compteurs.aPreparer],
            ["Préparés", situation.compteurs.prepares],
            ["Validés", situation.compteurs.valides],
          ] as const
        ).map(([titre, n]) => (
          <Card key={titre} className="!py-3">
            <p className="text-xs text-navy/60">{titre}</p>
            <p className="font-display text-xl font-bold tabular-nums">{n}</p>
          </Card>
        ))}
      </div>

      <PreparerPaieLot mois={mois} aPreparer={situation.compteurs.aPreparer} enAttente={situation.enAttente} peutValider={appUser.role === "direction"} anomalies={aVerifier.length + bloquantes.length} />

      <section className="mb-6" aria-labelledby="anomalies">
        <h2 id="anomalies" className="mb-2 text-lg">
          Anomalies ({situation.anomalies.length})
        </h2>
        {situation.anomalies.length === 0 ? (
          <Card className="text-sm text-navy/70">Aucune anomalie détectée pour {label}.</Card>
        ) : (
          <Card className="!p-0">
            <ul className="divide-y divide-navy/[0.07]">
              {situation.anomalies.map((a, i) => (
                <li key={`${a.userId}-${a.code}-${i}`} className="flex flex-col gap-1 px-4 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/equipe/paie/${a.userId}?mois=${mois}`} className="font-semibold underline-offset-2 hover:underline">
                      {nomsAvecLien.get(a.userId) ?? a.nom}
                    </Link>
                    <span className={a.gravite === "bloquante" ? "badge-orange" : "badge-neutral"}>{LIBELLE_ANOMALIE[a.code]}</span>
                    {a.gravite === "bloquante" && <span className="text-xs text-navy/60">bloque la préparation</span>}
                  </span>
                  <span className="text-navy/70">{a.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section aria-labelledby="comparaison">
        <h2 id="comparaison" className="mb-2 text-lg">
          Comparaison avec le mois précédent
        </h2>
        {situation.lignes.length === 0 ? (
          <EmptyState title="Aucun salarié actif." />
        ) : (
          <Card className="!p-0">
            <div className="hidden grid-cols-[minmax(0,1.3fr)_repeat(6,minmax(0,1fr))] gap-x-3 border-b border-navy/10 px-4 py-2 text-xs font-semibold text-navy/60 md:grid">
              <span>Salarié</span>
              <span>Net</span>
              <span>Écart net</span>
              <span>Heures</span>
              <span>Écart heures</span>
              <span>Primes</span>
              <span>Écart primes</span>
            </div>
            <ul>
              {situation.lignes.map((l) => (
                <Ligne key={l.userId} l={l} mois={mois} />
              ))}
            </ul>
          </Card>
        )}
        <p className="mt-2 text-xs text-navy/55">Le net est signalé au-delà de {SEUIL_VARIATION_NET_POURCENT} % d&apos;écart. Les écarts n&apos;existent que pour les bulletins déjà préparés.</p>
      </section>
    </div>
  );
}
