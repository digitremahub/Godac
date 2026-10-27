"use client";

import { useAffectations, type EntreeAffectation } from "@/components/planning/AffectationElements";
import type { LigneTournee } from "@/lib/planning/affectation";
import { estOuverte, FILTRES_OUVERTURE, libelleFermeture, type FiltreOuverture } from "@/lib/planning/ouverture";
import { texteAAttribuer } from "@/lib/planning/fusion";
import { libellePastille, messageDoublon, messageVerrou, type DoublonFusion, type VerrouFusion } from "@/lib/planning/fusion-verrou";
import { jourDe, libelleJour, rangJour } from "@/lib/planning/semaine";

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

/**
 * « Fermer cette tournée » sur une case sans chauffeur : elle ne roule pas ce
 * jour-là (férié, pas de volume…), elle n'est plus « à pourvoir » ni surveillée.
 * Marine GODAC, 44 px. Rien si la personne ne peut pas modifier le planning.
 */
export function BoutonFermerNonAffectee({ ligne, date, className = "" }: { ligne: LigneTournee; date: string; className?: string }) {
  const ctx = useAffectations();
  if (!ctx.donnees.peutModifier) return null;
  return (
    <button
      type="button"
      disabled={ctx.occupe}
      onClick={() => ctx.changerFermeture(ligne, [date], true)}
      aria-label={`Fermer la tournée ${ligne.tourNumber} du ${date.slice(8, 10)}/${date.slice(5, 7)} : elle ne roule pas ce jour-là`}
      title="Elle ne roule pas ce jour-là : elle n'est plus à pourvoir ni surveillée, et ne s'affecte plus tant qu'elle est fermée"
      className={`btn-dark min-h-[44px] !px-3 text-sm max-md:min-h-[48px] max-md:text-base ${className}`}
    >
      Fermer cette tournée
    </button>
  );
}

/** Encart d'une tournée fermée sans chauffeur : qui l'a fermée et quand (le bouton « Rouvrir » est à côté). */
export function EncartFermee({ entree }: { entree: EntreeAffectation }) {
  const ctx = useAffectations();
  return (
    <p className="flex min-h-[52px] items-center rounded-xl border-2 border-navy/15 bg-navy/[0.05] px-3 py-2 text-sm max-md:text-base" role="status">
      <span>
        <strong>{libelleFermeture(ctx.donnees.fermeesPar[entree.id], entree.closed_at)}.</strong> Elle ne roule pas ce jour-là : plus à pourvoir, plus surveillée, non affectable.
      </span>
    </p>
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
  // Sans chauffeur et ouverte : « Fermer cette tournée » (BoutonFermerNonAffectee) est l'action mise en avant.
  if (!fermee && !entree.driver_id) return null;
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

// ---------------------------------------------------------------------------
// Tournée d'origine d'une fusion : case verrouillée (lib/planning/fusion-verrou.ts).
// ---------------------------------------------------------------------------

/** Hachures discrètes d'une case verrouillée : l'encre du thème, jamais une couleur de palette. */
export const HACHURES = { backgroundImage: "repeating-linear-gradient(135deg, rgb(var(--c-ink) / 0.07) 0 6px, transparent 6px 12px)" } as const;

/**
 * Pastille « Fusionnée avec n°106 » (marine GODAC) : un clic ouvre la tournée
 * hôte du jour. Lecture seule : simple étiquette.
 */
export function PastilleFusionnee({ verrou, court = false, className = "" }: { verrou: VerrouFusion; court?: boolean; className?: string }) {
  const ctx = useAffectations();
  const texte = libellePastille(verrou);
  const base = `inline-flex max-w-full items-center justify-center rounded-full bg-marine px-2.5 py-0.5 text-center text-[11px] font-bold leading-tight text-white max-md:text-sm ${className}`;
  const contenu = court ? `→ ${verrou.hoteNumero}` : texte;
  if (!ctx.donnees.peutModifier) {
    return (
      <span className={base} title={texte} aria-label={texte}>
        {contenu}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={ctx.occupe}
      onClick={() => ctx.ouvrirHote(verrou)}
      title={`${texte} : ouvrir la tournée ${verrou.hoteNumero}`}
      aria-label={`${texte} : ouvrir la tournée ${verrou.hoteNumero}`}
      className={`${base} min-h-[32px] hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal max-md:min-h-[44px] max-md:px-3`}
    >
      {contenu}
    </button>
  );
}

/** Badge « Doublon » (rouge GODAC en dur, comme « Fermée »). */
export function BadgeDoublon({ court = false }: { court?: boolean }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold max-md:text-sm" style={ROUGE} title="Une affectation existe déjà sur cette tournée fusionnée" aria-label="Doublon : affectation sur une tournée fusionnée">
      {court ? "D" : "Doublon"}
    </span>
  );
}

/** « La tournée n°105 est déjà affectée à X : retirez-le ou conservez la tournée séparée » + « Retirer l'affectation ». */
export function LigneDoublon({ doublon }: { doublon: DoublonFusion }) {
  const ctx = useAffectations();
  const retirable = doublon.status === "planned" && ctx.donnees.peutModifier && !doublon.entryId.startsWith("tmp:");
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface p-3 text-sm max-md:text-base" style={{ boxShadow: "inset 4px 0 0 #d62718" }}>
      <p className="flex flex-wrap items-center gap-2">
        <BadgeDoublon />
        <span>
          <strong>{libelleJour(doublon.date)}</strong> · {messageDoublon({ tourNumber: doublon.tourNumber, nom: ctx.nomChauffeur(doublon.driverId), hoteNumero: doublon.verrou.hoteNumero })}
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        {retirable && (
          <button type="button" disabled={ctx.occupe} onClick={() => ctx.retirerDoublon(doublon)} className="btn-dark min-h-[44px] !px-3 text-sm max-md:min-h-[48px] max-md:w-full max-md:text-base">
            Retirer l&apos;affectation
          </button>
        )}
        {ctx.donnees.peutModifier && (
          <button type="button" disabled={ctx.occupe} onClick={() => ctx.ouvrirHote(doublon.verrou)} className="btn-secondary min-h-[44px] !px-3 text-sm max-md:min-h-[48px] max-md:w-full max-md:text-base">
            Ouvrir la n°{doublon.verrou.hoteNumero} (garder séparée)
          </button>
        )}
        {doublon.status !== "planned" && <span className="self-center text-xs text-navy/65">Tournée déjà démarrée : l&apos;affectation ne peut plus être retirée d&apos;ici.</span>}
      </div>
    </div>
  );
}

/** Encart d'une carte (vue Jour, Semaine sur téléphone) verrouillée : le message clair, le lien vers la tournée hôte, le doublon éventuel. */
export function EncartFusionnee({ verrou, doublons }: { verrou: VerrouFusion; doublons: DoublonFusion[] }) {
  const ctx = useAffectations();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-xl border-2 border-navy/15 px-3 py-2.5 text-sm max-md:text-base" style={HACHURES} role="status">
        <p>
          <strong>{messageVerrou(verrou)}</strong> Elle n&apos;est plus à pourvoir ni surveillée, et ne s&apos;affecte pas.
        </p>
        {ctx.donnees.peutModifier && (
          <button type="button" disabled={ctx.occupe} onClick={() => ctx.ouvrirHote(verrou)} className="btn-dark min-h-[44px] self-start !px-3 text-sm max-md:min-h-[48px] max-md:w-full max-md:text-base">
            Ouvrir la tournée n°{verrou.hoteNumero}
          </button>
        )}
      </div>
      {doublons.map((d) => (
        <LigneDoublon key={d.entryId} doublon={d} />
      ))}
    </div>
  );
}

/** Bandeau de la période : tous les doublons à traiter, avec « Retirer l'affectation ». Rien sans doublon. */
export function BandeauDoublons() {
  const ctx = useAffectations();
  if (ctx.doublons.length === 0) return null;
  const n = ctx.doublons.length;
  return (
    <section aria-label="Doublons de tournées fusionnées" role="alert" className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 bg-surface p-3" style={{ borderColor: "#d62718" }}>
      <h3 className="text-base font-bold">
        {n} doublon{n > 1 ? "s" : ""} : tournée{n > 1 ? "s" : ""} fusionnée{n > 1 ? "s" : ""} déjà affectée{n > 1 ? "s" : ""}
      </h3>
      <p className="text-sm text-navy/75 max-md:text-base">Le travail serait compté deux fois. Tant qu&apos;un doublon subsiste, la semaine n&apos;est pas envoyée toute seule aux chauffeurs le vendredi.</p>
      <div className="flex flex-col gap-2">
        {ctx.doublons.map((d) => (
          <LigneDoublon key={d.entryId} doublon={d} />
        ))}
      </div>
    </section>
  );
}
