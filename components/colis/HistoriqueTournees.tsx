import Link from "next/link";
import HistoriqueCarte from "@/components/colis/HistoriqueCarteDynamique";
import { Card, EmptyState } from "@/components/ui";
import { HistoriqueFiltres, LigneCliquable } from "@/components/colis/HistoriqueFiltres";
import { versParams, type Historique, type detailTournee, type LigneColis, type RechercheColis, type rechercherColis } from "@/lib/colis/historique";
import { SupprimerTourneeDirection } from "@/components/colis/SupprimerTourneeDirection";
import { estMarque, libellePreuve, libelleStatut } from "@/lib/colis/livraison";
import { BadgeArret, EncocheArret } from "@/components/colis/Ramasse";
import { formatPoids } from "@/lib/colis/poids";
import { libelleMotif } from "@/lib/colis/cloture";

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
  direction = false,
  recherche = { q: null, statut: null },
  resultats = null,
}: {
  historique: Historique;
  detail: Awaited<ReturnType<typeof detailTournee>>;
  aujourdhui: string;
  encadrement: boolean;
  /** Direction : peut supprimer une tournée (même clôturée), avec audit. */
  direction?: boolean;
  recherche?: RechercheColis;
  resultats?: Awaited<ReturnType<typeof rechercherColis>>;
}) {
  const { filtres, lignes, page, pages, total } = historique;
  const garde = { q: recherche.q, statut: recherche.statut };
  const lien = (extra: Record<string, string | null>, p = page) => `/exploitation/historique/colis?${versParams({ ...filtres, page: p }, aujourdhui, { ...garde, ...extra }).toString()}`;

  return (
    <div className="flex flex-col gap-4">
      <HistoriqueFiltres du={filtres.du} au={filtres.au} services={encadrement ? historique.services : null} chauffeurs={historique.chauffeurs} camions={historique.camions} />
      <p className="-mt-2 text-xs text-navy/55">Tournées conservées 12 mois (adresses, initiales et photos pour les contestations) ; noms complets, téléphones et consignes effacés après 30 jours.</p>

      {historique.erreur && <Card className="text-orange-ink">{historique.erreur}</Card>}

      {resultats && <ResultatsColis resultats={resultats} lienTournee={(id) => lien({ tournee: id })} encadrement={encadrement} />}

      {detail && <DetailTournee detail={detail} fermer={lien({})} direction={direction} />}

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

function DetailTournee({ detail, fermer, direction }: { detail: NonNullable<Awaited<ReturnType<typeof detailTournee>>>; fermer: string; direction: boolean }) {
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
        <div className="flex flex-wrap gap-2">
          <Link href={fermer} className="btn-secondary !py-1.5 text-sm" scroll={false}>
            Fermer
          </Link>
          {direction && <SupprimerTourneeDirection runId={run.id} nom={run.name ?? "Tournée"} cloturee={run.status === "done"} retour={fermer} />}
        </div>
      </div>
      {arrets.length > 0 && <HistoriqueCarte stops={arrets.map((s) => ({ id: s.id, address: s.address, status: s.status, lat: s.lat, lng: s.lng, done_at: s.done_at }))} depot={run.start_lat !== null && run.start_lng !== null ? { lat: Number(run.start_lat), lng: Number(run.start_lng) } : null} />}
      {arrets.length === 0 ? (
        <p className="text-sm text-navy/60">Aucun arrêt dans cette tournée.</p>
      ) : (
        <ol className="divide-y divide-navy/[0.07]">
          {arrets.map((s, i) => (
            <li key={s.id} className={`relative py-2 ${estMarque(s) ? "pl-3" : ""}`}>
              <EncocheArret stop={s} />
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
                  <BadgeArret stop={s} className="mb-1" />
                  <p className="text-sm font-semibold leading-snug">{s.address}</p>
                  <p className="text-xs text-navy/60">
                    {[
                      libelleStatut(s),
                      s.done_at && heure(s.done_at),
                      s.status === "delivered" && libellePreuve(s),
                      s.status === "failed" && libelleMotif(s.failure_reason),
                      s.recipient,
                      s.parcel_count > 1 && `${s.parcel_count} colis`,
                      formatPoids(s.weight_kg),
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

const STATUT_ARRET: Record<string, string> = { delivered: "Livré", failed: "Échec", pending: "Non fait" };

/** Résultats de la recherche d'un colis (code, destinataire, adresse) sur la période. */
function ResultatsColis({
  resultats,
  lienTournee,
  encadrement,
}: {
  resultats: NonNullable<Awaited<ReturnType<typeof rechercherColis>>>;
  lienTournee: (runId: string) => string;
  encadrement: boolean;
}) {
  const { lignes, tronque, erreur } = resultats;
  return (
    <Card className="flex flex-col gap-2 !p-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h2 className="text-lg">Colis trouvés</h2>
        <p className="text-xs text-navy/60">
          {lignes.length} arrêt{lignes.length > 1 ? "s" : ""}
          {tronque && " (200 premiers : précisez la recherche)"}
        </p>
      </div>
      {erreur && <p className="px-4 text-sm text-orange-ink">{erreur}</p>}
      {lignes.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-navy/60">Aucun colis ne correspond sur cette période.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs text-navy/60">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Heure</th>
                {encadrement && <th className="px-3 py-2">Chauffeur</th>}
                <th className="px-3 py-2">Colis</th>
                <th className="px-3 py-2">Destinataire · adresse</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Mode et preuve</th>
                <th className="px-3 py-2">Tournée</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((s: LigneColis) => (
                <tr key={s.id} className="border-t border-navy/5 align-top">
                  <td className="whitespace-nowrap px-3 py-2">{s.run_date ? date(s.run_date) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{heure(s.done_at)}</td>
                  {encadrement && <td className="px-3 py-2">{s.chauffeur}</td>}
                  <td className="px-3 py-2 font-mono text-xs">
                    {s.parcel_code ?? "—"}
                    {s.parcel_count > 1 && <span className="block font-sans text-navy/60">{s.parcel_count} colis</span>}
                  </td>
                  <td className="px-3 py-2">
                    {s.recipient && <span className="block font-semibold">{s.recipient}</span>}
                    <span className="text-navy/70">{s.address}</span>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-2 ${s.status === "failed" ? "text-orange-ink" : ""}`}>
                    {s.kind && s.kind !== "livraison" ? libelleStatut(s) : STATUT_ARRET[s.status]}
                    {s.status === "failed" && libelleMotif(s.failure_reason) && <span className="block text-xs">{libelleMotif(s.failure_reason)}</span>}
                  </td>
                  <td className="px-3 py-2">
                    {s.status === "delivered" ? (libellePreuve(s) ?? "—") : "—"}
                    {s.proof_photo_path && (
                      <a href={`/api/colis/arrets/${s.id}/livraison`} target="_blank" rel="noreferrer" className="ml-2 text-xs font-semibold text-teal-ink hover:underline">
                        📷 Photo
                      </a>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={lienTournee(s.run_id)} className="font-semibold text-teal-ink hover:underline" scroll={false}>
                      {s.tournee ?? "Tournée"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
