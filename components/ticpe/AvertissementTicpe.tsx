/**
 * Le rappel « document indicatif » (MENTION_INDICATIVE) est affiché en tête de
 * toute la section Carburant par BandeauIndicatif (app/(dashboard)/carburant/layout.tsx).
 * Ce composant ne garde que l'avis de mise à jour de la base, propre aux écrans TICPE.
 */
export function AvertissementTicpe({ migrationManquante = false }: { migrationManquante?: boolean }) {
  if (!migrationManquante) return null;
  return (
    <div className="mb-4 rounded-xl border border-navy/10 bg-navy/[0.03] px-4 py-2.5 text-sm text-navy/75">
      <p className="text-xs text-orange-ink">
        Mise à jour de la base en attente : réglages par défaut et barème intégré utilisés, sans enregistrement possible.
      </p>
    </div>
  );
}
