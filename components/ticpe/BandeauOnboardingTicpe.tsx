"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { compteurOnboarding, signatureOnboarding, type EtapeOnboarding } from "@/lib/ticpe/onboarding";

/**
 * Bandeau d'accueil du tableau de bord TICPE : ce qu'il manque pour que les
 * montants soient fiables, avec un lien d'action par étape et un compteur.
 * Refermable : la fermeture est mémorisée dans le navigateur et ne vaut que
 * pour les points en attente à ce moment-là (un nouveau point le fait revenir).
 */
export function BandeauOnboardingTicpe({ etapes, organizationId }: { etapes: EtapeOnboarding[]; organizationId: string }) {
  const signature = signatureOnboarding(etapes);
  const cle = `ticpe-onboarding:${organizationId}`;
  const [ferme, setFerme] = useState(false);

  useEffect(() => {
    try {
      setFerme(window.localStorage.getItem(cle) === signature);
    } catch {
      // Stockage indisponible (navigation privée) : le bandeau reste affiché.
    }
  }, [cle, signature]);

  const { restantes, total } = compteurOnboarding(etapes);
  if (restantes === 0 || ferme) return null;

  function fermer() {
    setFerme(true);
    try {
      window.localStorage.setItem(cle, signature);
    } catch {
      // Sans stockage, la fermeture ne vaut que pour cette page.
    }
  }

  return (
    <section aria-label="Fiabiliser la TICPE" className="mb-6 rounded-xl border border-navy/[0.12] bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-navy">Fiabiliser la TICPE</h2>
          <p className="text-sm text-navy/70">
            <span className="font-semibold text-orange-ink">{restantes}</span> point{restantes > 1 ? "s" : ""} sur {total} à compléter pour que les montants soient fiables avant la déclaration.
          </p>
        </div>
        <button type="button" onClick={fermer} className="btn-ghost min-h-[44px] text-sm" aria-label="Fermer le bandeau">
          Fermer
        </button>
      </div>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {etapes.map((e) => (
          <li key={e.id} className="flex items-start gap-3 rounded-lg border border-navy/10 p-3">
            <span aria-hidden className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs ${e.restant > 0 ? "badge-orange" : "badge-teal"}`}>
              {e.restant > 0 ? e.restant : "✓"}
            </span>
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-navy">{e.titre}</span>
              <span className="block text-navy/70">{e.detail}</span>
              {e.restant > 0 && (
                <Link href={e.lien} className="inline-flex min-h-[44px] items-center text-teal-ink underline">
                  Compléter →
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
