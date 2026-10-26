"use client";

import { useAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";
import { estOuverte, FILTRES_OUVERTURE, libelleFermeture, type FiltreOuverture } from "@/lib/planning/ouverture";
import { texteAAttribuer } from "@/lib/planning/fusion";
import { jourDe, rangJour } from "@/lib/planning/semaine";

/** Rouge GODAC écrit en dur (#d62718) : il ne change pas avec le thème, comme celui du suivi des tournées. */
const ROUGE = { backgroundColor: "#d62718", color: "#FFFFFF" } as const;

/** Pastille « Fermée » d'une tournée (rien si elle est ouverte). */
export function PastilleFermee({ entree, court = false }: { entree: EntreeAffectation; court?: boolean }) {
  const ctx = useAffectations();
  if (estOuverte(entree)) return null;
  const texte = libelleFermeture(ctx.donnees.fermeesPar[entree.id], entree.closed_at);
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold max-md:text-sm" style={ROUGE} title={texte} aria-label={texte}>
      {court ? "F" : "Fermée"}
    </span>
  );
}

/** Pastille « Fusion · 3 à attribuer » d'une tournée fusionnée (rien sinon). */
export function PastilleFusion({ entree }: { entree: EntreeAffectation }) {
  const ctx = useAffectations();
  const f = ctx.donnees.fusions[entree.id];
  if (!f) return null;
  const reste = f.aAttribuer > 0;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold max-md:text-sm ${reste ? "bg-orange/15 text-orange-ink" : "bg-success/15 text-success-ink"}`}
      title={`Tournée fusionnée (${f.tournees.join(", ") || "tournées à choisir"}) : ${reste ? `${f.aAttribuer} sur ${f.total} à attribuer` : "tout est attribué"}${f.provisoires ? `, ${f.provisoires} provisoire${f.provisoires > 1 ? "s" : ""}` : ""}`}
    >
      Fusion{f.total ? (reste ? ` · ${f.aAttribuer} à attribuer` : " · attribuée") : ""}
    </span>
  );
}

/** Un clic : « Fermer » / « Rouvrir » (droits et confirmation vérifiés par l'API). */
export function BoutonOuverture({ entree, className = "" }: { entree: EntreeAffectation; className?: string }) {
  const ctx = useAffectations();
  if (!ctx.donnees.peutModifier || entree.id.startsWith("tmp:") || (entree.status !== "planned" && entree.status !== "in_progress")) return null;
  const fermee = !estOuverte(entree);
  return (
    <button
      type="button"
      disabled={ctx.occupe}
      onClick={() => ctx.basculerOuverture(entree)}
      aria-label={`${fermee ? "Rouvrir" : "Fermer"} la tournée ${entree.tour_number} de ${heureLisible(entree.start_at)}`}
      className={`btn-secondary min-h-[44px] !px-3 text-sm max-md:min-h-[48px] max-md:text-base ${className}`}
    >
      {fermee ? "Rouvrir" : "Fermer"}
    </button>
  );
}

/** « Répartir » (tournée fusionnée) ; le lundi, ou si la tournée est déjà fusionnée, on propose aussi de la marquer. */
export function BoutonRepartir({ entree, toujours = false, className = "" }: { entree: EntreeAffectation; toujours?: boolean; className?: string }) {
  const ctx = useAffectations();
  if (!ctx.donnees.peutModifier || entree.id.startsWith("tmp:") || (entree.status !== "planned" && entree.status !== "in_progress")) return null;
  const f = ctx.donnees.fusions[entree.id];
  const lundi = rangJour(jourDe(entree.start_at)) === 0;
  if (!f && !lundi && !toujours) return null;
  return (
    <button
      type="button"
      disabled={ctx.occupe}
      onClick={() => ctx.ouvrirRepartition(entree)}
      className={`btn-secondary min-h-[44px] !px-3 text-sm max-md:min-h-[48px] max-md:text-base ${className}`}
      title={f ? texteAAttribuer({ villagesAAttribuer: f.aAttribuer, ramassesAAttribuer: 0 }) : "Regrouper plusieurs tournées en une seule et répartir ses villages et ses ramasses"}
    >
      {f ? "Répartir" : "Tournée fusionnée…"}
    </button>
  );
}

const heureLisible = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** Filtre « Toutes / Ouvertes / Fermées » du planning. */
export function FiltreOuvertureBarre({ valeur, onChange, fermees }: { valeur: FiltreOuverture; onChange: (v: FiltreOuverture) => void; fermees: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-lg bg-navy/[0.05] p-1" role="group" aria-label="Filtrer les tournées par ouverture">
        {FILTRES_OUVERTURE.map((f) => (
          <button
            key={f.valeur}
            type="button"
            aria-pressed={valeur === f.valeur}
            onClick={() => onChange(f.valeur)}
            className={`min-h-[44px] rounded-md px-3 text-sm max-md:min-h-[48px] max-md:text-base ${valeur === f.valeur ? "bg-surface font-semibold shadow-sm" : "text-navy/65 hover:text-navy"}`}
          >
            {f.libelle}
            {f.valeur === "fermees" && fermees > 0 ? <span className="ml-1.5 tabular-nums">{fermees}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
