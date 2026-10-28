import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const utilisateur = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: () => utilisateur() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));
vi.mock("@/lib/go-navigation/etat", () => ({ lireEtatOffre: async () => ({ goNavigation: false, essaiTermine: false, trialEndsAt: null, country: "FR" }) }));
const suspendu = vi.fn();
vi.mock("@/lib/comptes-essai/garde", () => ({ compteSuspenduDeLUtilisateurCourant: () => suspendu(), organisationSuspendueAdmin: async () => false, compteSuspenduPour: async () => false }));
// garderPage
const utilisateurPage = vi.fn();
vi.mock("@/lib/acces/modules-requete", () => ({ utilisateurCourant: () => utilisateurPage(), modulesActifs: async () => new Set<string>() }));
const redirections: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirections.push(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/components/acces/EtatAcces", () => ({ EtatAcces: () => null }));

import { garderApi } from "@/lib/acces/garde-api";
import { garderPage } from "@/lib/acces/garde-page";
import { MESSAGE_COMPTE_SUSPENDU } from "@/lib/comptes-essai/regles";
import { titreRefus, lireRefus } from "@/lib/http/fetch-godac";

beforeEach(() => {
  utilisateur.mockReset();
  suspendu.mockReset();
  utilisateurPage.mockReset();
  redirections.length = 0;
});

describe("garderApi : compte suspendu", () => {
  it("403 COMPTE_SUSPENDU avec un message clair (pas « session expirée »), pour toute route gardée", async () => {
    utilisateur.mockResolvedValue(null);
    suspendu.mockResolvedValue(true);
    for (const opts of [{ roles: "tous" as const }, { ecran: "carburant.ticpe" }, { roles: ["direction" as const], modules: ["planning" as const] }]) {
      const r = await garderApi(opts);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reponse.status).toBe(403);
        expect(await r.reponse.json()).toEqual({ error: MESSAGE_COMPTE_SUSPENDU, code: "COMPTE_SUSPENDU" });
      }
    }
  });
  it("sans session et compte non suspendu : 401 comme avant", async () => {
    utilisateur.mockResolvedValue(null);
    suspendu.mockResolvedValue(false);
    const r = await garderApi({ roles: "tous" });
    expect(!r.ok && r.reponse.status).toBe(401);
  });
  it("utilisateur normal : accès accordé, la garde de suspension n'est pas consultée", async () => {
    utilisateur.mockResolvedValue({ id: "u1", organization_id: "o1", role: "direction", conduit: false });
    const r = await garderApi({ roles: ["direction"] });
    expect(r.ok).toBe(true);
    expect(suspendu).not.toHaveBeenCalled();
  });
  it("le client HTTP reconnaît le code et lui donne un titre", () => {
    const refus = lireRefus(403, { error: MESSAGE_COMPTE_SUSPENDU, code: "COMPTE_SUSPENDU" });
    expect(refus.code).toBe("COMPTE_SUSPENDU");
    expect(titreRefus(refus)).toBe("Compte suspendu par GODAC");
  });
});

describe("garderPage : compte suspendu", () => {
  it("affiche l'écran « Compte suspendu » au lieu de rediriger vers l'inscription", async () => {
    utilisateurPage.mockResolvedValue(null);
    suspendu.mockResolvedValue(true);
    const g = await garderPage("exploitation.colis");
    expect(g.ok).toBe(false);
    expect(redirections).toEqual([]);
    if (!g.ok) expect((g.ecran.type as { name: string }).name).toBe("CompteSuspendu");
  });
  it("sans session et sans suspension : redirection /onboarding comme avant", async () => {
    utilisateurPage.mockResolvedValue(null);
    suspendu.mockResolvedValue(false);
    await expect(garderPage("exploitation.colis")).rejects.toThrow("NEXT_REDIRECT /onboarding");
  });
});

describe("branchements dans l'application (contrat de code)", () => {
  const lire = (f: string) => readFileSync(f, "utf8");
  it("le layout du tableau de bord affiche l'écran avant toute inscription automatique", () => {
    const src = lire("app/(dashboard)/layout.tsx");
    expect(src).toContain("compteSuspenduDeLUtilisateurCourant()");
    expect(src.indexOf("compteSuspenduDeLUtilisateurCourant()")).toBeLessThan(src.indexOf("tryAutoProvisionInvitedUser()"));
    expect(src).toContain("<CompteSuspendu />");
  });
  it("l'inscription automatique d'un invité ne recrée pas de profil dans une organisation suspendue", () => {
    const src = lire("lib/auth/provisioning.ts");
    expect(src).toContain("organisationSuspendueAdmin(organizationId, true)");
    expect(src.indexOf("organisationSuspendueAdmin")).toBeLessThan(src.indexOf(".upsert("));
  });
  it("l'assistant de création d'organisation n'est jamais proposé à un compte suspendu", () => {
    const src = lire("app/onboarding/page.tsx");
    expect(src).toContain("compteSuspenduPour(user.id)");
    expect(src.indexOf("compteSuspenduPour")).toBeLessThan(src.indexOf("<OnboardingWizard"));
  });
  it("getCurrentAppUser rend null pour un compte suspendu et la lecture se fait à chaque appel (aucun cache)", () => {
    const src = lire("lib/auth/session.ts");
    expect(src).toContain("organisationSuspendue(supabase, data.organization_id as string)");
    expect(src).not.toMatch(/new Map|cache\(/);
  });
  it("routes publiques, webhooks et crons ne dépendent pas de la suspension", () => {
    const mw = lire("middleware.ts");
    expect(mw).not.toMatch(/suspendue|comptes-essai/);
    for (const f of ["app/api/webhooks/stripe/route.ts", "app/api/cron/retention/route.ts", "app/api/public/go-navigation/inscription/route.ts"]) {
      expect(lire(f), f).not.toMatch(/suspendue|compteSuspendu|getCurrentAppUser/);
    }
  });
  it("l'écran de suspension : titre, contact, déconnexion, motif interne jamais affiché", () => {
    const src = lire("components/comptes-essai/CompteSuspendu.tsx");
    expect(src).toContain("Compte suspendu par GODAC");
    expect(src).toContain("EDITEUR.email");
    expect(src).toContain("<SignOutButton />");
    expect(src).toContain('aria-labelledby="compte-suspendu-titre"');
    expect(src).not.toContain("suspendue_motif");
  });
});
