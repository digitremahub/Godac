"use client";

import { useMemo, useState } from "react";
import { Fenetre } from "@/components/planning/Fenetre";
import { Avatar, useAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";
import {
  cleCaseTournee,
  connaitTournee,
  estAbsent,
  etatChauffeurDuJour,
  joursChoisis,
  joursDuMois,
  libelleIndisponibilite,
  nomCourt,
  RANGS_LUNDI_SAMEDI,
  rangsDesJoursPrevus,
  type LigneTournee,
} from "@/lib/planning/affectation";
import { HEURE_VALIDE } from "@/lib/planning/heure";
import { basculerRang, chauffeursAffiches, heureDe, joursDeLaSemaine, JOURS_COURTS, JOURS_LONGS, libelleJour, rangJour, statutAffectation } from "@/lib/planning/semaine";

export type CibleFeuille = { type: "case"; cle: string; date: string } | { type: "ligne"; cle: string };

export interface ActionsFeuille {
  placer: (ligne: LigneTournee, dates: string[], chauffeur: { id: string; full_name: string }, heure?: { valeur: string; imposee?: boolean }) => void;
  retirer: (entree: EntreeAffectation) => void;
  supprimer: (entree: EntreeAffectation) => void;
  modifier: (entree: EntreeAffectation) => void;
}

/**
 * « Affecter à… » : l'équivalent au toucher, au clic et au clavier de tous
 * les gestes de glisser. Sur téléphone c'est le seul chemin (feuille du bas).
 * - une case : chauffeurs disponibles d'abord, déjà pris (2ᵉ tournée)
 *   ensuite, absents grisés ; retirer, prolonger les jours suivants,
 *   modifier l'heure ou le véhicule, supprimer ce jour ;
 * - une ligne (⇥ semaine / mois) : un chauffeur pour les jours choisis
 *   (pastilles L M M J V S D, pré-cochées selon les jours habituels de la
 *   tournée ; le samedi et le dimanche restent cliquables). Ses jours
 *   d'absence restent « à remplacer ».
 */
export function FeuilleAffecter({ cible, actions, onFermer }: { cible: CibleFeuille; actions: ActionsFeuille; onFermer: () => void }) {
  const ctx = useAffectations();
  const { donnees } = ctx;
  const ligne = ctx.lignes.find((l) => l.cle === cible.cle);
  const [recherche, setRecherche] = useState("");

  // « Toute la semaine / tout le mois » : tous les jours de la période, dimanche compris,
  // même s'il n'est pas affiché ; les jours déjà passés ne se proposent pas.
  const periode = useMemo(() => (donnees.vue === "mois" ? joursDuMois(donnees.mois, true) : donnees.vue === "semaine" ? joursDeLaSemaine(donnees.lundi) : [...ctx.jours]), [donnees.vue, donnees.mois, donnees.lundi, ctx.jours]);
  const depuis = donnees.vue === "jour" ? undefined : ctx.aujourdhui;
  const [rangs, setRangs] = useState<number[]>(() => {
    const habituels = ligne ? rangsDesJoursPrevus(ligne.joursPrevus) : [];
    const possibles = habituels.filter((r) => joursChoisis(periode, [r], depuis).length > 0);
    return possibles.length ? possibles : joursChoisis(periode, [0, 1, 2, 3, 4], depuis).length ? [0, 1, 2, 3, 4] : [];
  });
  const datesCible = useMemo(() => (!ligne ? [] : cible.type === "case" ? [cible.date] : joursChoisis(periode, rangs, depuis)), [cible, ligne, periode, rangs, depuis]);
  const entrees: EntreeAffectation[] = cible.type === "case" && ligne ? (ctx.parCase.get(cleCaseTournee(ligne.cle, cible.date)) ?? []) : [];
  const tenue = entrees.find((e) => e.driver_id);
  // Heure de départ : celle de la case (ou habituelle de la tournée), modifiable ici.
  const heureInitiale = entrees[0] ? heureDe(entrees[0].start_at) : (ligne?.heure ?? "07:00");
  const [heure, setHeure] = useState(heureInitiale);
  const heureChoisie = HEURE_VALIDE.test(heure) && heure !== heureInitiale ? { valeur: heure, imposee: true } : { valeur: heureInitiale };

  const chauffeurs = useMemo(() => {
    const visibles = chauffeursAffiches(donnees.chauffeurs, donnees.rattachements, donnees.serviceIds, ctx.affectations);
    const q = recherche.trim().toLowerCase();
    return visibles
      .filter((c) => !q || c.full_name.toLowerCase().includes(q))
      .map((c) => {
        if (cible.type === "case") {
          const e = etatChauffeurDuJour(c.id, cible.date, ctx.affectations, donnees.conges, donnees.arrets);
          const sous = e.etat === "absent" && e.indispo ? libelleIndisponibilite(e.indispo) : e.etat === "pris" ? `Déjà sur ${e.tournees.join(" + ")}` : e.indispo ? `Disponible · ${libelleIndisponibilite(e.indispo).toLowerCase()}` : "Disponible";
          return { ...c, etat: e.etat, sous: ligne && e.etat !== "absent" && connaitTournee(c.id, ligne.tourNumber, donnees.historique) ? `${sous} · connaît ${ligne.tourNumber}` : sous };
        }
        const absents = datesCible.filter((d) => estAbsent(c.id, d, donnees.conges, donnees.arrets));
        const etat = absents.length === datesCible.length && datesCible.length > 0 ? ("absent" as const) : ("disponible" as const);
        return { ...c, etat, sous: absents.length ? `${absents.length === datesCible.length ? "Absent sur toute la période" : `Absent ${absents.map((d) => libelleJour(d)).join(", ")} (restera à remplacer)`}` : "Disponible" };
      })
      .filter((c) => c.id !== tenue?.driver_id)
      .sort((a, b) => ordre(a.etat) - ordre(b.etat) || a.full_name.localeCompare(b.full_name, "fr"));
  }, [donnees, ctx.affectations, recherche, cible, ligne, datesCible, tenue]);

  if (!ligne) return null;
  const titre = cible.type === "case" ? `${tenue ? "Remplacer sur" : "Affecter"} ${ligne.tourNumber} à…` : `${ligne.tourNumber} ${donnees.vue === "mois" ? "tout le mois" : "toute la semaine"} à…`;
  const sousTitre =
    cible.type === "case"
      ? `${JOURS_LONGS[rangJour(cible.date)]} ${Number(cible.date.slice(8, 10))}/${cible.date.slice(5, 7)} · ${entrees[0] ? heureDe(entrees[0].start_at) : ligne.heure}${ligne.villages.length ? ` · ${ligne.villages.slice(0, 2).join(", ")}` : ""}`
      : datesCible.length
        ? `${datesCible.length} jour${datesCible.length > 1 ? "s" : ""} : ${libelleJour(datesCible[0]!)} → ${libelleJour(datesCible.at(-1)!)} · ${ligne.heure}`
        : "Cochez au moins un jour.";

  // Prolonger (équivalent de la poignée) : jours suivants de la même semaine.
  const suivants = cible.type === "case" && tenue && donnees.vue !== "jour" ? ctx.jours.filter((d) => d > cible.date && d <= finDeSemaine(cible.date)) : [];

  return (
    <Fenetre titre={titre} sousTitre={sousTitre} onFermer={onFermer} large>
      {entrees.length > 0 && (
        <ul className="mb-3 flex flex-col gap-2">
          {entrees.map((e) => {
            const modifiable = e.status === "planned";
            const nom = e.driver_id ? ctx.nomChauffeur(e.driver_id) : null;
            return (
              <li key={e.id} className="rounded-xl border border-navy/10 p-2.5">
                <div className="flex items-center gap-2.5">
                  {e.driver_id && nom ? <Avatar id={e.driver_id} nom={nom} /> : <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-dashed border-orange text-orange-ink">!</span>}
                  <span className="min-w-0 flex-1 text-sm leading-tight">
                    <strong>{nom ?? "À remplacer"}</strong>
                    <span className="block text-xs text-navy/60">
                      {heureDe(e.start_at)} · {e.vehicles?.registration ?? "sans véhicule"}
                      {modifiable ? "" : ` · ${statutAffectation(e.status).libelle.toLowerCase()}`}
                    </span>
                  </span>
                </div>
                {donnees.peutModifier && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {modifiable && e.driver_id && (
                      <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={() => actions.retirer(e)}>
                        Retirer le chauffeur
                      </button>
                    )}
                    <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={() => actions.modifier(e)}>
                      {modifiable ? "Heure, véhicule…" : "Détails"}
                    </button>
                    {modifiable && (
                      <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm text-orange-ink" onClick={() => actions.supprimer(e)}>
                        Supprimer ce jour
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {suivants.length > 0 && tenue?.driver_id && tenue.status === "planned" && (
        <div className="mb-3">
          <p className="label">Prolonger {nomCourt(ctx.nomChauffeur(tenue.driver_id))} jusqu&apos;à…</p>
          <div className="flex flex-wrap gap-1.5">
            {suivants.map((d) => (
              <button
                key={d}
                type="button"
                className="btn-secondary min-h-[44px] !px-3 text-sm"
                onClick={() => actions.placer(ligne, ctx.jours.filter((x) => x > (cible as { date: string }).date && x <= d), { id: tenue.driver_id!, full_name: ctx.nomChauffeur(tenue.driver_id) }, { valeur: heureDe(tenue.start_at) })}
              >
                {libelleJour(d)}
              </button>
            ))}
          </div>
        </div>
      )}

      {cible.type === "ligne" && donnees.peutModifier && (
        <div className="mb-3">
          <p className="label">Jours à remplir</p>
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Jours à remplir">
            {JOURS_COURTS.map((lettre, r) => {
              const dispo = joursChoisis(periode, [r], depuis).length > 0;
              const coche = rangs.includes(r);
              const habituel = rangsDesJoursPrevus(ligne.joursPrevus).includes(r);
              return (
                <button
                  key={r}
                  type="button"
                  disabled={!dispo}
                  aria-pressed={coche}
                  aria-label={`${JOURS_LONGS[r]}${habituel ? " (jour habituel)" : ""}`}
                  onClick={() => setRangs((v) => basculerRang(v, r))}
                  className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border-2 text-base font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-35 ${
                    coche ? "border-orange bg-orange/15 text-orange-ink" : "border-navy/15 bg-surface text-navy/70 hover:border-orange/50"
                  }`}
                >
                  {lettre}
                  <span className={`h-1.5 w-1.5 rounded-full ${habituel ? "bg-current opacity-60" : "opacity-0"}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={() => setRangs(RANGS_LUNDI_SAMEDI.filter((r) => joursChoisis(periode, [r], depuis).length > 0))}>
              Lun → Sam
            </button>
            <button type="button" className="btn-secondary min-h-[44px] !px-3 text-sm" onClick={() => setRangs(rangsDesJoursPrevus(ligne.joursPrevus).filter((r) => joursChoisis(periode, [r], depuis).length > 0))}>
              Jours habituels
            </button>
          </div>
          <p className="mt-1 text-sm text-navy/60">Le point marque les jours où la tournée roule d&apos;habitude.</p>
        </div>
      )}

      {donnees.peutModifier && (cible.type === "ligne" ? datesCible.length > 0 : true) && (
        <>
          <div className="mb-3">
            <label className="label" htmlFor="heure-depart">
              Heure de départ
            </label>
            <input id="heure-depart" type="time" required value={heure} onChange={(e) => setHeure(e.target.value)} className="input min-h-[48px] w-40 text-base" aria-describedby="aide-heure" />
            <p id="aide-heure" className="mt-1 text-sm text-navy/60">
              {heure !== heureInitiale ? `Changée (habituelle : ${heureInitiale}) : appliquée à tous les jours posés.` : "Heure habituelle de la tournée ; modifiable pour ce placement."}
            </p>
          </div>
          <p className="label">{tenue ? "Remplacer par" : "Choisir le chauffeur"}</p>
          {chauffeurs.length > 8 && (
            <input data-autofocus className="input mb-2 min-h-[44px]" placeholder="Rechercher un chauffeur…" value={recherche} onChange={(e) => setRecherche(e.target.value)} aria-label="Rechercher un chauffeur" />
          )}
          <ul className="flex max-h-[45vh] flex-col gap-1.5 overflow-y-auto overscroll-contain">
            {chauffeurs.map((c) => {
              const absent = c.etat === "absent";
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={absent}
                    onClick={() => actions.placer(ligne, datesCible, c, heureChoisie)}
                    className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${absent ? "cursor-not-allowed border-navy/5 opacity-45" : "border-navy/10 hover:border-teal/60 hover:bg-teal/[0.06]"} ${c.etat === "pris" ? "opacity-75" : ""}`}
                  >
                    <Avatar id={c.id} nom={c.full_name} attenue={absent} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-bold">{c.full_name}</span>
                      <span className="block truncate text-xs text-navy/60">{c.sous}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            {chauffeurs.length === 0 && <li className="p-2 text-sm text-navy/60">Aucun chauffeur ne correspond.</li>}
          </ul>
        </>
      )}
    </Fenetre>
  );
}

const ordre = (e: string) => (e === "disponible" ? 0 : e === "pris" ? 1 : 2);
const finDeSemaine = (d: string) => {
  const dt = new Date(`${d}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + (6 - rangJour(d)));
  return dt.toISOString().slice(0, 10);
};
