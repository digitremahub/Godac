import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// ── Faux client Supabase de la session ──────────────────────────────
type Rep = { data: unknown; error: { code?: string; message: string } | null };
let authUser: { id: string; email?: string } | null;
let profil: (colonnes: string) => Rep;
let organisation: () => Rep;
let deconnexions = 0;
const colonnesLues: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: authUser } }), signOut: async () => void deconnexions++ },
    from: (table: string) => ({
      select: (colonnes: string) => {
        if (table === "users") colonnesLues.push(colonnes);
        return { eq: () => ({ maybeSingle: async () => (table === "users" ? profil(colonnes) : organisation()) }) };
      },
    }),
  }),
}));

// ── Faux client service (garde d'affichage et approvisionnement) ────
let adminUsers: Rep;
let adminOrg: Rep;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => (table === "users" ? adminUsers : adminOrg) }) }) }),
  }),
}));

import { getCurrentAppUser } from "@/lib/auth/session";
import { compteSuspenduDeLUtilisateurCourant, compteSuspenduPour, organisationSuspendueAdmin } from "@/lib/comptes-essai/garde";

const LIGNE = { id: "u1", organization_id: "o1", role: "direction", role_title: null, full_name: "Jean", email: "j@x.fr", phone: null, active: true, pending_approval: false, can_drive: false };
const ok = (data: unknown): Rep => ({ data, error: null });
const err = (code: string): Rep => ({ data: null, error: { code, message: code === "42703" ? "column organizations.suspendue_le does not exist" : "boom" } });

beforeEach(() => {
  authUser = { id: "u1", email: "j@x.fr" };
  profil = () => ok({ ...LIGNE });
  organisation = () => ok({ suspendue_le: null });
  adminUsers = ok({ organization_id: "o1" });
  adminOrg = ok({ suspendue_le: null });
  deconnexions = 0;
  colonnesLues.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getCurrentAppUser : compte suspendu", () => {
  it("compte actif : le profil est rendu", async () => {
    const u = await getCurrentAppUser();
    expect(u).toMatchObject({ id: "u1", organization_id: "o1", role: "direction" });
  });

  it("organisation suspendue : null pour tous les rôles, sans déconnecter (l'écran « Compte suspendu » s'affiche)", async () => {
    organisation = () => ok({ suspendue_le: "2026-11-16T10:00:00Z" });
    for (const role of ["direction", "manager", "exploitation", "comptable", "chauffeur"]) {
      profil = () => ok({ ...LIGNE, role });
      expect(await getCurrentAppUser(), role).toBeNull();
    }
    expect(deconnexions).toBe(0);
  });

  it("session déjà ouverte : bloquée au prochain appel, rétablie dès la levée de la suspension", async () => {
    expect(await getCurrentAppUser()).not.toBeNull();
    organisation = () => ok({ suspendue_le: "2026-11-16T10:00:00Z" });
    expect(await getCurrentAppUser()).toBeNull();
    organisation = () => ok({ suspendue_le: null });
    expect(await getCurrentAppUser()).not.toBeNull();
  });

  it("migration non appliquée (colonne absente) : personne n'est bloqué", async () => {
    organisation = () => err("42703");
    expect(await getCurrentAppUser()).not.toBeNull();
  });

  it("état de suspension illisible (incident) : accès refusé par prudence", async () => {
    organisation = () => err("XX000");
    expect(await getCurrentAppUser()).toBeNull();
  });

  it("le profil rendu ne porte aucune colonne de suspension ; le motif n'est jamais lu côté client", async () => {
    const u = (await getCurrentAppUser()) as unknown as Record<string, unknown>;
    expect(Object.keys(u).some((k) => k.startsWith("suspendue"))).toBe(false);
    expect(Object.keys(u)).not.toContain("organizations");
    expect(colonnesLues.every((c) => !c.includes("suspendue"))).toBe(true);
  });

  it("comportements existants conservés : non connecté, compte désactivé, inscription à approuver", async () => {
    authUser = null;
    expect(await getCurrentAppUser()).toBeNull();
    authUser = { id: "u1" };
    profil = () => ok({ ...LIGNE, active: false });
    expect(await getCurrentAppUser()).toBeNull();
    expect(deconnexions).toBe(1);
    profil = () => ok({ ...LIGNE, pending_approval: true });
    expect(await getCurrentAppUser()).toBeNull();
    expect(deconnexions).toBe(2);
  });

  it("colonne can_drive absente : relit sans elle (comportement existant) puis contrôle la suspension", async () => {
    profil = (c) => (c.includes("can_drive") ? err("42703") : ok({ ...LIGNE }));
    organisation = () => ok({ suspendue_le: "2026-11-16T10:00:00Z" });
    expect(await getCurrentAppUser()).toBeNull();
    organisation = () => ok({ suspendue_le: null });
    expect(await getCurrentAppUser()).toMatchObject({ id: "u1" });
  });
});

describe("garde d'affichage (choix du message)", () => {
  it("vrai seulement pour un compte réellement suspendu", async () => {
    expect(await compteSuspenduDeLUtilisateurCourant()).toBe(false);
    adminOrg = ok({ suspendue_le: "2026-11-16T10:00:00Z" });
    expect(await compteSuspenduDeLUtilisateurCourant()).toBe(true);
    expect(await compteSuspenduPour("u1")).toBe(true);
  });
  it("non connecté, sans profil, ou erreur : faux (jamais d'exception)", async () => {
    adminOrg = ok({ suspendue_le: "2026-11-16T10:00:00Z" });
    authUser = null;
    expect(await compteSuspenduDeLUtilisateurCourant()).toBe(false);
    adminUsers = ok(null);
    expect(await compteSuspenduPour("u1")).toBe(false);
    adminUsers = ok({ organization_id: "o1" });
    adminOrg = err("XX000");
    expect(await compteSuspenduPour("u1")).toBe(false);
  });
  it("organisationSuspendueAdmin : valeur de doute pour les gardes, migration absente = actif", async () => {
    adminOrg = err("XX000");
    expect(await organisationSuspendueAdmin("o1", true)).toBe(true);
    expect(await organisationSuspendueAdmin("o1", false)).toBe(false);
    adminOrg = err("42703");
    expect(await organisationSuspendueAdmin("o1", true)).toBe(false);
  });
});
