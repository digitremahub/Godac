/**
 * Squelette affiché pendant le chargement d'une page serveur (loading.tsx) :
 * titre, rangée de tuiles et deux blocs, aux couleurs du thème (jetons
 * navy / surface), pour que l'écran ne reste jamais blanc ou figé.
 */
export function EcranChargement({ tuiles = 4 }: { tuiles?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse">
      <span className="sr-only">Chargement…</span>
      <div className="mb-2 h-8 w-56 rounded-lg bg-navy/[0.08]" />
      <div className="mb-6 h-4 w-80 max-w-full rounded bg-navy/[0.06]" />
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: tuiles }, (_, i) => (
          <div key={i} className="h-24 rounded-2xl border border-navy/[0.08] bg-surface" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="h-64 rounded-2xl border border-navy/[0.08] bg-surface lg:col-span-2" />
        <div className="h-64 rounded-2xl border border-navy/[0.08] bg-surface" />
      </div>
    </div>
  );
}
