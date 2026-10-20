"use client";

import { questionRegroupement, type ChoixRequis, type Regroupement } from "@/lib/colis/fiches-affectation";

export type ChoixRegroupementData = Pick<ChoixRequis, "existantes" | "fiches_ouvertes">;

/** Réponse 409 de POST /api/colis/affectations quand il faut choisir séparées ou reliées. */
export function lireChoixRequis(status: number, json: unknown): ChoixRegroupementData | null {
  const d = json as { choix_requis?: boolean; existantes?: ChoixRequis["existantes"]; fiches_ouvertes?: ChoixRequis["fiches_ouvertes"] } | null;
  if (status !== 409 || !d?.choix_requis) return null;
  return { existantes: Array.isArray(d.existantes) ? d.existantes : [], fiches_ouvertes: Array.isArray(d.fiches_ouvertes) ? d.fiches_ouvertes : [] };
}

/**
 * Question posée à l'encadrement quand le chauffeur a déjà une tournée ce
 * jour-là : fiches colis séparées (recommandé) ou reliées en une seule.
 */
export function ChoixRegroupement({ choix, busy, onChoisir, onAnnuler }: { choix: ChoixRegroupementData; busy: boolean; onChoisir: (r: Regroupement) => void; onAnnuler: () => void }) {
  return (
    <div role="alertdialog" aria-live="polite" className="mt-3 rounded-xl border border-orange/30 bg-orange/10 p-3 text-sm text-navy">
      <p className="font-medium">{questionRegroupement(choix)}</p>
      <p className="mt-1 text-xs text-navy/65">Séparées : une fiche par tournée, le chauffeur choisit laquelle démarrer. Reliées : villages, ramasses et points relais sur une seule fiche (exceptionnel).</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => onChoisir("separee")}>Fiches séparées (recommandé)</button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onChoisir("reliee")}>Relier en une seule tournée</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  );
}
