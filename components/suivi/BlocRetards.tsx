"use client";

import type { TourneeSuivie } from "@/app/api/suivi/route";
import { LIBELLES_ETAT, aSurveiller, libelleRetard, libelleSignal, trierRetards } from "@/lib/exploitation/retards";
import { lienTel } from "@/lib/colis/telephone";
import { COULEUR_ETAT } from "@/components/suivi/etat";

/**
 * Retards en tête du suivi en direct : tournées en cours à surveiller, en
 * retard ou dont le chauffeur n'a plus de signal, les plus graves d'abord.
 * Chaque ligne : chauffeur, tournée, retard estimé, arrêts restants, appel
 * du chauffeur et accès à la tournée. Pas de SMS aux clients restants :
 * GODAC n'envoie aucun message aux clients (le chauffeur les prévient
 * depuis son application).
 */
export function BlocRetards({ tournees, onVoir }: { tournees: TourneeSuivie[]; onVoir: (id: string) => void }) {
  const enCours = tournees.filter((t) => t.statut === "in_progress" && t.retard);
  const alertes = trierRetards(enCours.filter((t) => aSurveiller(t.retard!)).map((t) => ({ ...t.retard!, tournee: t })));
  if (enCours.length === 0) return null;
  if (alertes.length === 0) {
    return (
      <p className="rounded-xl bg-navy/[0.04] px-4 py-3 text-sm text-navy/70" role="status">
        Aucun retard : les {enCours.length} tournée{enCours.length > 1 ? "s" : ""} en cours sont dans les temps.
      </p>
    );
  }
  return (
    <section aria-labelledby="retards-titre" className="rounded-2xl border border-navy/10 bg-surface p-4 shadow-card">
      <h2 id="retards-titre" className="font-display text-base font-bold">
        Retards <span className="tabular-nums text-navy/60">({alertes.length})</span>
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {alertes.map(({ tournee: t, ...r }) => {
          const couleur = COULEUR_ETAT[r.etat];
          const prochain = t.arrets.find((a) => a.status === "pending");
          return (
            <li key={t.id} className="flex flex-col gap-2 rounded-xl border border-navy/10 p-3 sm:flex-row sm:items-center">
              <span className="w-fit shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold" style={{ background: couleur.fond, color: couleur.texte }}>
                {LIBELLES_ETAT[r.etat]}
              </span>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">
                  {t.chauffeur}
                  {t.nom ? <span className="font-normal text-navy/60"> · {t.nom}</span> : null}
                </p>
                <p className="text-xs text-navy/65">
                  {r.retardMin > 0 ? <strong className="text-navy">Retard estimé {libelleRetard(r.retardMin)}</strong> : "Pas de retard estimé"}
                  {r.arretEnCause && r.cause === "creneau" ? ` (créneau de l'arrêt ${r.arretEnCause.ordre})` : ""} · {r.arretsRestants} arrêt{r.arretsRestants > 1 ? "s" : ""} restant{r.arretsRestants > 1 ? "s" : ""}
                  {r.horsLigne ? ` · position ${libelleSignal(r.signal, r.derniereMajMin)}` : ""}
                </p>
                {prochain && <p className="truncate text-xs text-navy/55">Prochain arrêt : {prochain.adresse}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {t.telephone ? (
                  <a href={lienTel(t.telephone)} className="btn-dark !py-1.5 text-xs">
                    Appeler le chauffeur
                  </a>
                ) : (
                  <span className="self-center text-xs text-navy/50">Pas de numéro</span>
                )}
                <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={() => onVoir(t.id)}>
                  Voir la tournée
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
