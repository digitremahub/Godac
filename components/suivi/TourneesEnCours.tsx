import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { ETATS_FILTRE, compterParEtat, filtrerEnCours, type FiltreEnCours, type TourneeEnCours } from "@/lib/exploitation/en-cours";
import { LIBELLES_ETAT, libelleRetard } from "@/lib/exploitation/retards";
import type { EtatTournee } from "@/lib/exploitation/retards";

const BADGE: Record<EtatTournee, string> = { en_retard: "badge-orange", a_surveiller: "badge-gold", hors_ligne: "badge-neutral", dans_les_temps: "badge-teal" };
const heure = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) : "—");
const jourCourt = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}`;
const telephone = (t: string) => t.replace(/[^\d+]/g, "");

/**
 * Vue « Tournées en cours » : toutes les tournées démarrées que le rôle
 * peut voir (le périmètre est appliqué au chargement), en cartes empilées
 * sur mobile, avec compteur par état et filtres par service et par état.
 * `carte` : adresse de la carte de suivi (colis) quand elle est ouverte à la personne.
 */
export function TourneesEnCours({
  tournees,
  services,
  filtre,
  base,
  carte,
}: {
  tournees: readonly TourneeEnCours[];
  services: { id: string; name: string }[];
  filtre: FiltreEnCours;
  base: string;
  carte: string | null;
}) {
  const c = compterParEtat(tournees);
  const vues = filtrerEnCours(tournees, filtre);
  const lien = (extra: { service?: string | null; etat?: string | null }) => {
    const q = new URLSearchParams();
    const service = extra.service === undefined ? filtre.service : extra.service;
    const etat = extra.etat === undefined ? filtre.etat : extra.etat;
    if (service) q.set("service", service);
    if (etat) q.set("etat", etat);
    return `${base}${q.size ? `?${q}` : ""}#en-cours`;
  };
  return (
    <section id="en-cours" aria-labelledby="titre-en-cours" className="mb-6 scroll-mt-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titre-en-cours" className="text-lg">
          Tournées en cours <span className="text-navy/60">({c.total})</span>
        </h2>
        <p className="text-sm text-navy/65" aria-live="polite">
          {c.en_retard} en retard · {c.a_surveiller} à surveiller · {c.hors_ligne} hors ligne · {c.dans_les_temps} dans les temps
        </p>
      </div>

      <nav aria-label="Filtrer les tournées en cours" className="mb-3 flex flex-wrap items-center gap-2">
        <Link href={lien({ etat: null })} className={filtre.etat ? "btn-secondary min-h-[44px] text-sm" : "btn-primary min-h-[44px] text-sm"} aria-current={filtre.etat ? undefined : "true"}>
          Toutes
        </Link>
        {ETATS_FILTRE.map((e) => (
          <Link key={e} href={lien({ etat: e })} className={filtre.etat === e ? "btn-primary min-h-[44px] text-sm" : "btn-secondary min-h-[44px] text-sm"} aria-current={filtre.etat === e ? "true" : undefined}>
            {LIBELLES_ETAT[e]} ({c[e]})
          </Link>
        ))}
        {services.length > 1 && (
          <span className="flex flex-wrap items-center gap-2">
            <Link href={lien({ service: null })} className={filtre.service ? "btn-secondary min-h-[44px] text-sm" : "btn-primary min-h-[44px] text-sm"}>
              Tous les services
            </Link>
            {services.map((s) => (
              <Link key={s.id} href={lien({ service: s.id })} className={filtre.service === s.id ? "btn-primary min-h-[44px] text-sm" : "btn-secondary min-h-[44px] text-sm"} aria-current={filtre.service === s.id ? "true" : undefined}>
                {s.name}
              </Link>
            ))}
          </span>
        )}
      </nav>

      {vues.length === 0 ? (
        <EmptyState title={tournees.length === 0 ? "Aucune tournée en cours" : "Aucune tournée pour ce filtre"} description={tournees.length === 0 ? "Les tournées démarrées apparaissent ici." : "Changez de filtre pour voir les autres tournées."} />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {vues.map((t) => (
            <li key={t.cle}>
              <Card className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{t.nom}</p>
                    <p className="truncate text-sm text-navy/65">
                      {t.chauffeur} · {t.services.map((s) => s.nom).join(", ") || "Sans service"}
                    </p>
                  </div>
                  <span className={BADGE[t.etat]}>{LIBELLES_ETAT[t.etat]}</span>
                </div>
                {t.ouverteDepuis && <p className="text-sm text-orange-ink">Ouverte depuis le {jourCourt(t.ouverteDepuis)}</p>}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-navy/60">Véhicule</dt>
                  <dd>{t.vehicule ?? "—"}</dd>
                  <dt className="text-navy/60">Démarrée</dt>
                  <dd>{heure(t.demarreeA)}</dd>
                  <dt className="text-navy/60">Fin prévue</dt>
                  <dd>{heure(t.finPrevue)}</dd>
                  {t.retardMin > 0 && (
                    <>
                      <dt className="text-navy/60">Retard</dt>
                      <dd>{libelleRetard(t.retardMin)}</dd>
                    </>
                  )}
                  {t.avancement && (
                    <>
                      <dt className="text-navy/60">Avancement</dt>
                      <dd>
                        {t.avancement.faits} / {t.avancement.total} adresses
                      </dd>
                    </>
                  )}
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {t.telephone && (
                    <a href={`tel:${telephone(t.telephone)}`} className="btn-secondary min-h-[44px] text-sm">
                      Appeler
                    </a>
                  )}
                  {t.source === "colis" && carte && (
                    <Link href={`${carte}?tournee=${t.id}`} className="btn-secondary min-h-[44px] text-sm">
                      Voir sur la carte
                    </Link>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
