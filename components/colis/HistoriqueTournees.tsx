import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { HistoriqueFiltres, LigneCliquable } from "@/components/colis/HistoriqueFiltres";
import { versParams, type Historique, type detailTournee } from "@/lib/colis/historique";
import { estRamasse, libellePreuve, libelleStatut } from "@/lib/colis/livraison";
import { BadgeRamasse, EncocheRamasse } from "@/components/colis/Ramasse";

const STATUTS: Record<string, string> = { loading: "En chargement", in_progress: "En livraison", done: "Clôturée" };

const heure = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "—");
const date = (jour: string) => new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Onglet « Historique » de la tournée colis : filtres (période, service,
 * chauffeur, camion), tableau paginé des tournées et détail en lecture
 * seule de la tournée choisie (?tournee=<id>).
 */
export function HistoriqueTournees({
  historique,
  detail,
  aujourdhui,
  encadrement,
}: {
  historique: Historique;
  detail: Awaited<ReturnType<typeof detailTournee>>;
  aujourdhui: string;
  encadrement: boolean;
}) {
  const { filtres, lignes, page, pages, total } = historique;
  const lien = (extra: Record<string, string | null>, p = page) => `/colis?${versParams({ ...filtres, page: p }, aujourdhui, extra).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <HistoriqueFiltres du={filtres.du} au={filtres.au} services={encadrement ? historique.services : null} chauffeurs={historique.chauffeurs} camions={historique.camions} />
      <p className="-mt-2 text-xs text-navy/55">Tournées conservées 12 mois (adresses, initiales et photos pour les contestations) ; noms complets, téléphones et consignes effacés après 30 jours.</p>

      {historique.erreur && <Card className="text-orange-ink">{historique.erreur}</Card>}

      {detail && <DetailTournee detail={detail} fermer={lien({})} />}

      {lignes.length === 0 ? (
        <EmptyState title="Aucune tournée sur cette période" description="Élargissez la période ou retirez un filtre." />
      ) : (
        <Card className="overflow-x-auto !p-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-xs text-navy/60">
              <tr>
                <th className="px-3 py-2.5">Date</th>
                {encadrement && <th className="px-3 py-2.5">Chauffeur</th>}
                <th className="px-3 py-2.5">Service(s)</th>
                <th className="px-3 py-2.5">Camion</th>
                <th className="px-3 py-2.5">Tournée</th>
                <th className="px-3 py-2.5 text-right">Listes</th>
                <th className="px-3 py-2.5 text-right">Arrêts</th>
                <th className="px-3 py-2.5 text-right">Livrés</th>
                <th className="px-3 py-2.5 text-right">Échecs</th>
                <th className="px-3 py-2.5 text-right">Colis</th>
                <th className="px-3 py-2.5">Début → fin</th>
                <th className="px-3 py-2.5 text-right">Km ≈</th>
                <th className="px-3 py-2.5">Statut</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const href = lien({ tournee: l.id });
                return (
                  <LigneCliquable key={l.id} href={href} selection={detail?.run.id === l.id}>
                    <td className="whitespace-nowrap px-3 py-2">{date(l.run_date)}</td>
                    {encadrement && <td className="px-3 py-2">{l.chauffeur}</td>}
                    <td className="px-3 py-2">{l.nomsServices.join(", ") || "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{l.immatriculation ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Link href={href} className="font-semibold text-teal-ink hover:underline">
                        {l.nom ?? "Tournée"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.listes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.arrets}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.livres}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${l.echecs ? "text-orange-ink" : ""}`}>{l.echecs}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.colis}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                      {heure(l.debut)} → {heure(l.fin)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l.km ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{STATUTS[l.statut] ?? l.statut}</td>
                  </LigneCliquable>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
        {page > 1 ? (
          <Link href={lien({}, page - 1)} className="btn-secondary !px-3 !py-1.5">
            ← Plus récentes
          </Link>
        ) : (
          <span />
        )}
        <span className="text-navy/60">
          {pages > 1 && `Page ${page} / ${pages} · `}
          {total} tournée{total > 1 ? "s" : ""}
        </span>
        {page < pages ? (
          <Link href={lien({}, page + 1)} className="btn-secondary !px-3 !py-1.5">
            Plus anciennes →
          </Link>
        ) : (
          <span />
        )}
      </nav>
      <p className="text-xs text-navy/55">
        Km ≈ : distance estimée entre les arrêts faits (vol d&apos;oiseau corrigé), pas un relevé de compteur. Service : services actuels du chauffeur. Camion : celui du
        planning du chauffeur ce jour-là.
      </p>
    </div>
  );
}

function DetailTournee({ detail, fermer }: { detail: NonNullable<Awaited<ReturnType<typeof detailTournee>>>; fermer: string }) {
  const { run, arrets, chauffeur, listes } = detail;
  const plusieursListes = listes > 1;
  return (
    <Card className="flex flex-col gap-3 border-2 border-teal/40">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg">{run.name ?? "Tournée"}</h2>
          <p className="text-sm text-navy/65">
            {date(run.run_date)} · {chauffeur} · {STATUTS[run.status] ?? run.status}
            {run.started_at && ` · démarrée à ${heure(run.started_at)}`}
            {run.start_label && ` · départ : ${run.start_label}`}
          </p>
        </div>
        <Link href={fermer} className="btn-secondary !py-1.5 text-sm" scroll={false}>
          Fermer
        </Link>
      </div>
      {arrets.length === 0 ? (
        <p className="text-sm text-navy/60">Aucun arrêt dans cette tournée.</p>
      ) : (
        <ol className="divide-y divide-navy/[0.07]">
          {arrets.map((s, i) => (
            <li key={s.id} className={`relative py-2 ${estRamasse(s) ? "pl-3" : ""}`}>
              {estRamasse(s) && <EncocheRamasse />}
              {plusieursListes && (i === 0 || arrets[i - 1]!.liste !== s.liste) && <p className="pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-navy/55">{s.liste}</p>}
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                    s.status === "delivered" ? "bg-teal text-marine" : s.status === "failed" ? "bg-orange text-white" : "bg-navy/10 text-navy/70"
                  }`}
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  {estRamasse(s) && <BadgeRamasse className="mb-1" />}
                  <p className="text-sm font-semibold leading-snug">{s.address}</p>
                  <p className="text-xs text-navy/60">
                    {[
                      libelleStatut(s),
                      s.done_at && heure(s.done_at),
                      s.status === "delivered" && libellePreuve(s),
                      s.recipient,
                      s.parcel_count > 1 && `${s.parcel_count} colis`,
                      s.parcel_code && `n° ${s.parcel_code}`,
                      s.notes,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {s.proof_photo_path && (
                  <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs" aria-label={`Photo de livraison — ${s.address}`}>
                    📷 Photo
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
