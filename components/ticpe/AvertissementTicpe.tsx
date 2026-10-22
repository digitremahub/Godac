import { AVERTISSEMENT_TICPE } from "@/lib/ticpe/reglages";

/** Rappel affiché sur tous les écrans TICPE. */
export function AvertissementTicpe({ migrationManquante = false }: { migrationManquante?: boolean }) {
  return (
    <div className="mb-4 rounded-xl border border-navy/10 bg-navy/[0.03] px-4 py-2.5 text-sm text-navy/75">
      <p>
        <span className="font-semibold">À savoir :</span> {AVERTISSEMENT_TICPE}
      </p>
      {migrationManquante && (
        <p className="mt-1 text-xs text-orange-ink">
          Mise à jour de la base en attente : réglages par défaut et barème intégré utilisés, sans enregistrement possible.
        </p>
      )}
    </div>
  );
}
