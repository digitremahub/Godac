import { describe, expect, it, vi } from "vitest";
import { VALIDITE_ETAT_CONNU_MS, etatEnCasDeLecture, lireEtatOffre, type EtatOffre } from "@/lib/go-navigation/etat";

const connu: EtatOffre = { goNavigation: true, essaiTermine: false, trialEndsAt: "2026-12-01T00:00:00Z", country: "FR" };

describe("repli quand la lecture de l'offre échoue", () => {
  it("sans valeur récente : offre indéterminée (accès par module refusés), jamais « essai en cours »", () => {
    const etat = etatEnCasDeLecture(undefined, 1_000);
    expect(etat.indetermine).toBe(true);
    expect(etat.essaiTermine).toBe(false);
  });
  it("avec une valeur récente : on garde le dernier état connu (y compris une fin d'essai)", () => {
    expect(etatEnCasDeLecture({ etat: connu, lu: 0 }, VALIDITE_ETAT_CONNU_MS)).toBe(connu);
    const fini = { ...connu, essaiTermine: true };
    expect(etatEnCasDeLecture({ etat: fini, lu: 0 }, 1000).essaiTermine).toBe(true);
  });
  it("valeur trop ancienne : indéterminée", () => {
    expect(etatEnCasDeLecture({ etat: connu, lu: 0 }, VALIDITE_ETAT_CONNU_MS + 1).indetermine).toBe(true);
  });
});

function client(reponses: Array<{ data?: unknown; error?: { code?: string; message?: string } | null } | Error>) {
  let i = 0;
  const requete = {
    select: () => requete,
    eq: () => requete,
    maybeSingle: async () => {
      const r = reponses[Math.min(i++, reponses.length - 1)]!;
      if (r instanceof Error) throw r;
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { from: () => requete } as never;
}

describe("lireEtatOffre", () => {
  it("une erreur de lecture renvoyée par la base ne ressemble plus à une offre classique", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const etat = await lireEtatOffre(client([{ error: { code: "08006", message: "connexion" } }]), "org-inconnue-1");
    expect(etat.indetermine).toBe(true);
  });
  it("une exception aussi", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const etat = await lireEtatOffre(client([new Error("réseau")]), "org-inconnue-2");
    expect(etat.indetermine).toBe(true);
  });
  it("après une lecture réussie, un incident réutilise l'état lu", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bon = await lireEtatOffre(client([{ data: { country: "FR", offre: "go_navigation", subscription_status: null, trial_ends_at: "2000-01-01T00:00:00Z" } }]), "org-connue");
    expect(bon.essaiTermine).toBe(true);
    const panne = await lireEtatOffre(client([new Error("réseau")]), "org-connue");
    expect(panne.indetermine).toBeUndefined();
    expect(panne.essaiTermine).toBe(true);
  });
  it("colonne offre absente (42703) : lecture sans elle, offre classique, pas d'incident", async () => {
    const etat = await lireEtatOffre(client([{ error: { code: "42703" } }, { data: { country: "BE" } }]), "org-ancienne");
    expect(etat).toMatchObject({ goNavigation: false, essaiTermine: false, country: "BE" });
    expect(etat.indetermine).toBeUndefined();
  });
});
