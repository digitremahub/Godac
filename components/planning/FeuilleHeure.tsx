"use client";

import { useState } from "react";
import { Fenetre } from "@/components/planning/Fenetre";
import { useAffectations } from "@/components/planning/AffectationElements";
import { modelesDeLaTournee, HEURE_VALIDE } from "@/lib/planning/heure";
import { addDays } from "@/lib/planning/dates";
import { joursDuMois } from "@/lib/planning/affectation";
import { libelleJour, rangJour } from "@/lib/planning/semaine";

export type PorteeHeure = { type: "periode"; debut: string; fin: string } | { type: "modele" };
export type CibleHeure = { cle: string; date: string | null };

/**
 * « Heure de la tournée » : change l'heure de départ d'une tournée depuis le
 * planning. Au choix : seulement ce jour (quand on vient d'un jour précis),
 * tous les jours de la semaine (ou du mois), ou « Toujours » = heure du
 * modèle de planning (prochaines générations ; sans modèle, l'option est
 * grisée). Les chauffeurs concernés sont prévenus comme pour tout changement.
 */
export function FeuilleHeure({ cible, onValider, onFermer }: { cible: CibleHeure; onValider: (ligneCle: string, heure: string, portee: PorteeHeure) => void; onFermer: () => void }) {
  const ctx = useAffectations();
  const { donnees } = ctx;
  const ligne = ctx.lignes.find((l) => l.cle === cible.cle);
  const [heure, setHeure] = useState(ligne?.heure ?? "07:00");
  if (!ligne) return null;

  const aUnModele = modelesDeLaTournee(donnees.modeles, ligne.serviceId, ligne.tourNumber).length > 0;
  const lundi = cible.date ? addDays(cible.date, -rangJour(cible.date)) : donnees.lundi;
  const options: { cle: string; titre: string; detail: string; portee: PorteeHeure; desactive?: boolean }[] = [];
  if (cible.date) options.push({ cle: "jour", titre: "Seulement ce jour", detail: libelleJour(cible.date), portee: { type: "periode", debut: cible.date, fin: cible.date } });
  if (donnees.vue === "mois" && !cible.date) {
    const duMois = joursDuMois(donnees.mois, true);
    options.push({ cle: "mois", titre: "Tous les jours de ce mois", detail: "Affectations déjà posées ce mois-ci", portee: { type: "periode", debut: duMois[0]!, fin: duMois.at(-1)! } });
  } else {
    options.push({ cle: "semaine", titre: "Tous les jours de cette semaine", detail: `${libelleJour(lundi)} → ${libelleJour(addDays(lundi, 6))}`, portee: { type: "periode", debut: lundi, fin: addDays(lundi, 6) } });
  }
  options.push({
    cle: "modele",
    titre: "Toujours (modèle)",
    detail: aUnModele ? "Heure habituelle de la tournée, pour les prochaines semaines" : "Cette tournée n'a pas de modèle de planning",
    portee: { type: "modele" },
    desactive: !aUnModele,
  });

  const valide = HEURE_VALIDE.test(heure);
  return (
    <Fenetre titre="Heure de la tournée" sousTitre={`${ligne.tourNumber} · actuellement ${ligne.heure}`} onFermer={onFermer}>
      <label className="label" htmlFor="heure-tournee">
        Heure de départ
      </label>
      <input id="heure-tournee" data-autofocus type="time" required value={heure} onChange={(e) => setHeure(e.target.value)} className="input mb-3 min-h-[48px] text-base" />
      <p className="label">Appliquer à…</p>
      <ul className="flex flex-col gap-2">
        {options.map((o) => (
          <li key={o.cle}>
            <button
              type="button"
              disabled={!valide || o.desactive}
              onClick={() => onValider(ligne.cle, heure, o.portee)}
              className="flex min-h-[56px] w-full flex-col items-start justify-center rounded-xl border border-navy/15 px-3 py-2 text-left hover:border-teal/60 hover:bg-teal/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal disabled:cursor-not-allowed disabled:opacity-45"
            >
              <span className="text-base font-bold">{o.titre}</span>
              <span className="text-sm text-navy/65">{o.detail}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-navy/60">Une tournée déjà démarrée ne change pas. Le chauffeur déjà placé est prévenu du changement d&apos;heure.</p>
    </Fenetre>
  );
}
