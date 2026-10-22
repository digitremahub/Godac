"use client";

import { useMemo, useState } from "react";
import { estAbsent, etatChauffeurDuJour, indisponibilite, joursPlacesParChauffeur, libelleIndisponibilite, nomCourt } from "@/lib/planning/affectation";
import { chauffeursAffiches, libelleJour, rangJour } from "@/lib/planning/semaine";
import { Avatar, Depot, Glissable, useAffectations } from "@/components/planning/AffectationElements";

type Filtre = "disponibles" | "tous" | "absents";
const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/**
 * Colonne Chauffeurs : on en glisse un sur une tournée, ou on le touche puis
 * on touche une case. Toute la colonne reçoit le chauffeur d'une tournée
 * qu'on y lâche : il est retiré (la tournée reste « à remplacer »).
 * - en congé validé / en arrêt (vue Jour : ce jour-là ; Semaine / Mois :
 *   toute la période) : grisé, non glissable ;
 * - déjà pris ce jour-là : semi-grisé mais glissable (→ « séparées ou reliées ? »).
 */
export function ColonneChauffeurs() {
  const ctx = useAffectations();
  const { donnees, jours } = ctx;
  const jour = donnees.vue === "jour" ? jours[0]! : null;
  const [filtre, setFiltre] = useState<Filtre>("disponibles");

  const liste = useMemo(() => {
    const visibles = chauffeursAffiches(donnees.chauffeurs, donnees.rattachements, donnees.serviceIds, ctx.affectations);
    const places = joursPlacesParChauffeur(ctx.affectations, jours);
    return visibles.map((c) => {
      const joursAbsent = jours.filter((d) => estAbsent(c.id, d, donnees.conges, donnees.arrets));
      const absentTout = joursAbsent.length === jours.length;
      if (jour) {
        const e = etatChauffeurDuJour(c.id, jour, ctx.affectations, donnees.conges, donnees.arrets);
        const sous =
          e.etat === "absent" && e.indispo
            ? libelleIndisponibilite(e.indispo)
            : e.etat === "pris"
              ? e.tournees.join(" + ")
              : e.indispo
                ? `Disponible · ${libelleIndisponibilite(e.indispo).toLowerCase()}`
                : "Disponible";
        return { ...c, etat: e.etat, sous, glissable: e.etat !== "absent", absentUnJour: e.etat === "absent" };
      }
      const n = places.get(c.id) ?? 0;
      let sous: string;
      if (absentTout) {
        const i = indisponibilite(c.id, jours[0]!, donnees.conges, donnees.arrets);
        sous = i ? `${i.type === "arret" ? "En arrêt" : "En congé"} ${donnees.vue === "mois" ? "tout le mois" : "toute la semaine"}` : "Absent";
      } else if (joursAbsent.length) {
        const i = indisponibilite(c.id, joursAbsent[0]!, donnees.conges, donnees.arrets);
        const quand = donnees.vue === "mois" ? `${libelleJour(joursAbsent[0]!)}${joursAbsent.length > 1 ? ` → ${libelleJour(joursAbsent.at(-1)!)}` : ""}` : joursAbsent.map((d) => JOURS[rangJour(d)]).join(" ");
        sous = `${n ? `${n} j placé${n > 1 ? "s" : ""} · ` : ""}${i?.type === "arret" ? "arrêt" : "congé"} ${quand}`;
      } else {
        sous = n ? `${n} jour${n > 1 ? "s" : ""} placé${n > 1 ? "s" : ""}` : donnees.vue === "mois" ? "Libre tout le mois" : "Libre toute la semaine";
      }
      return { ...c, etat: absentTout ? ("absent" as const) : n ? ("pris" as const) : ("disponible" as const), sous, glissable: !absentTout, absentUnJour: joursAbsent.length > 0 };
    });
  }, [donnees, ctx.affectations, jours, jour]);

  const filtres: { cle: Filtre; libelle: string; n: number }[] = [
    { cle: "disponibles", libelle: "Disponibles", n: liste.filter((c) => c.etat !== "absent").length },
    { cle: "tous", libelle: "Tous", n: liste.length },
    { cle: "absents", libelle: jour ? "En congé" : "Absences", n: liste.filter((c) => c.absentUnJour).length },
  ];
  const affiches = liste
    .filter((c) => (filtre === "tous" ? true : filtre === "absents" ? c.absentUnJour : c.etat !== "absent"))
    // Disponibles d'abord, puis pris, puis absents.
    .sort((a, b) => ordre(a.etat) - ordre(b.etat) || a.full_name.localeCompare(b.full_name, "fr"));

  return (
    <Depot id="retirer" actif={ctx.glisser}>
      {(survol, ref) => (
        <section ref={ref as any} aria-labelledby="titre-chauffeurs" className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 id="titre-chauffeurs" className="text-xs font-semibold uppercase tracking-[0.12em] text-navy/60">
              Chauffeurs
            </h2>
            <span className="text-xs font-semibold tabular-nums text-navy/55">
              {filtres[0]!.n} / {liste.length}
            </span>
          </div>
          <div className={`flex flex-col gap-2 rounded-2xl border-2 bg-surface p-2.5 shadow-card transition-colors ${survol ? "border-dashed border-orange bg-orange/[0.06]" : "border-transparent"}`}>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer les chauffeurs">
              {filtres.map((f) => (
                <button
                  key={f.cle}
                  type="button"
                  aria-pressed={filtre === f.cle}
                  onClick={() => setFiltre(f.cle)}
                  className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${filtre === f.cle ? "bg-marine text-white" : "bg-navy/[0.06] text-navy/75 hover:bg-navy/10"}`}
                >
                  {f.libelle}
                </button>
              ))}
            </div>
            {survol && <p className="rounded-xl border-2 border-dashed border-orange p-3 text-center text-sm font-semibold text-orange-ink">Relâchez pour retirer le chauffeur de la tournée</p>}
            {ctx.arme && (
              <p className="rounded-xl bg-orange/10 p-2.5 text-sm text-orange-ink" role="status">
                Touchez une tournée pour y placer <strong>{nomCourt(ctx.arme.full_name)}</strong>.{" "}
                <button type="button" className="underline" onClick={() => ctx.choisirChauffeur(null)}>
                  Annuler
                </button>
              </p>
            )}
            {affiches.length === 0 && <p className="p-2 text-sm text-navy/60">{filtre === "absents" ? "Personne d'absent sur la période." : "Aucun chauffeur à afficher."}</p>}
            <ul className="flex flex-col gap-1.5">
              {affiches.map((c) => {
                const absent = c.etat === "absent";
                const choisi = ctx.arme?.id === c.id;
                return (
                  <li key={c.id}>
                    <Glissable id={`ch:${c.id}`} actif={ctx.glisser && c.glissable}>
                      <button
                        type="button"
                        disabled={!donnees.peutModifier || absent}
                        aria-pressed={choisi}
                        onClick={() => ctx.choisirChauffeur(choisi ? null : { id: c.id, full_name: c.full_name })}
                        aria-label={`${c.full_name} : ${c.sous}${absent ? "" : ". Choisir pour le placer sur une tournée"}`}
                        className={`flex min-h-[52px] w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                          choisi ? "border-orange bg-orange/10" : absent ? "cursor-not-allowed border-navy/5 bg-navy/[0.03] opacity-50" : "border-navy/10 bg-surface hover:border-teal/50"
                        } ${c.etat === "pris" && !choisi ? "opacity-70" : ""}`}
                      >
                        <Avatar id={c.id} nom={c.full_name} attenue={absent || c.etat === "pris"} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-sm font-bold">{nomCourt(c.full_name)}</span>
                          <span className="block truncate text-xs text-navy/60">{c.sous}</span>
                        </span>
                        {c.glissable && ctx.glisser && (
                          <span aria-hidden="true" className="text-lg leading-none tracking-[-3px] text-navy/30">
                            ⋮⋮
                          </span>
                        )}
                      </button>
                    </Glissable>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}
    </Depot>
  );
}

const ordre = (e: string) => (e === "disponible" ? 0 : e === "pris" ? 1 : 2);
