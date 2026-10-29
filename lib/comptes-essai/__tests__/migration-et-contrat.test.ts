import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => null }));

import { ACTIONS_AUDIT } from "@/lib/audit/journal";

const lire = (f: string) => readFileSync(f, "utf8");
const MIGRATION = "supabase/migrations/20261116000001_comptes_suspension.sql";
/** Le SQL sans commentaires : les mots interdits ne comptent que dans les instructions. */
const sql = () => lire(MIGRATION).replace(/--.*$/gm, "");

describe("migration 20261116000001 : additive, idempotente, sans suppression", () => {
  it("le numéro est unique", () => {
    const fichiers = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    expect(fichiers).toContain("20261116000001_comptes_suspension.sql");
    expect(fichiers.filter((f) => f.startsWith("20261116000001"))).toHaveLength(1);
    // D'autres migrations peuvent la suivre (ex. 20261117000001_go_lieux.sql) : seule son unicité compte.
  });
  it("aucune instruction destructrice ni modification de données existantes", () => {
    const s = sql().toLowerCase();
    for (const interdit of [/\bdrop\b/, /\bdelete\b/, /\btruncate\b/, /\bupdate\s+(public\.)?\w+\s+set\b/, /\binsert\s+into\b/, /\balter\s+table[^;]*\bdrop\b/, /\brename\b/, /\balter\s+column\b/, /\bset\s+not\s+null\b/, /\bdisable\s+row\s+level\b/]) {
      expect(s, String(interdit)).not.toMatch(interdit);
    }
  });
  it("ajoute exactement les trois colonnes, nullables, avec « if not exists »", () => {
    const s = sql();
    for (const c of ["suspendue_le timestamptz", "suspendue_motif text", "suspendue_par text"]) expect(s).toContain(`add column if not exists ${c}`);
    expect(s.match(/add column/g)).toHaveLength(3);
    expect(s).not.toMatch(/suspendue_\w+\s+(timestamptz|text)\s+not null/);
    expect(s).not.toMatch(/default/i);
  });
  it("trigger anti-modification par les rôles clients, comme la fin de contrat", () => {
    const s = sql();
    expect(s).toContain("create or replace function public.organizations_guard_suspension()");
    expect(s).toContain("coalesce(auth.role(), '') not in ('anon', 'authenticated')");
    for (const c of ["suspendue_le", "suspendue_motif", "suspendue_par"]) expect(s).toContain(`new.${c} is distinct from old.${c}`);
    expect(s).toContain("errcode = '42501'");
    expect(s).toMatch(/before update on public\.organizations/);
    // Idempotent sans « drop trigger » : création conditionnelle.
    expect(s).toContain("if not exists");
    expect(s).toContain("tgname = 'organizations_guard_suspension'");
  });
  it("aucune policy de lecture créée ni modifiée (piège RLS : pas de fonction qui relit sa propre table)", () => {
    const s = sql().toLowerCase();
    expect(s).not.toMatch(/\bpolicy\b/);
    expect(s).not.toMatch(/row level security/);
    expect(s).not.toMatch(/security definer/);
  });
  it("index partiel et idempotent", () => {
    expect(sql()).toContain("create index if not exists organizations_suspendue_idx");
    expect(sql()).toContain("where suspendue_le is not null");
  });
  it("le code et la migration utilisent les mêmes noms de colonnes", () => {
    for (const f of ["lib/comptes-essai/actions.ts", "lib/comptes-essai/serveur.ts", "lib/auth/session.ts", "lib/comptes-essai/garde.ts"]) {
      expect(lire(f), f).toContain("suspendue_le");
    }
    const actions = lire("lib/comptes-essai/actions.ts");
    expect(actions).toContain("suspendue_motif");
    expect(actions).toContain("suspendue_par");
    expect(actions).toContain("20261116000001_comptes_suspension.sql");
  });
});

describe("journal d'audit", () => {
  it("les quatre actions sont déclarées avec un libellé français", () => {
    for (const a of ["compte_suspendu", "compte_retabli", "compte_revoque", "essai_termine_staff"] as const) expect(ACTIONS_AUDIT[a]).toMatch(/GODAC/);
  });
  it("actions.ts journalise chaque action avec le motif et l'e-mail du staff", () => {
    const src = lire("lib/comptes-essai/actions.ts");
    for (const a of ["compte_suspendu", "compte_retabli", "compte_revoque", "essai_termine_staff"]) expect(src).toContain(`"${a}"`);
    expect(src).toContain("journaliser(");
    expect(src).toMatch(/= \{ motif, par, organisation/);
  });
});

describe("accès : route et page réservées au staff GODAC", () => {
  it("la route vérifie l'e-mail staff avant toute lecture du corps ou écriture", () => {
    const src = lire("app/api/godac-staff/comptes-essai/[id]/route.ts");
    expect(src).toContain("isGodacStaffEmail(user?.email)");
    expect(src.indexOf("isGodacStaffEmail")).toBeLessThan(src.indexOf("req.json()"));
    expect(src.indexOf("isGodacStaffEmail")).toBeLessThan(src.indexOf("createAdminSupabaseClient()"));
    expect(src).toContain("status: 403");
    expect(src).not.toMatch(/garderApi/);
  });
  it("la page redirige tout non-staff avant de lire quoi que ce soit", () => {
    const src = lire("app/godac-staff/comptes-essai/page.tsx");
    expect(src).toContain("if (!isGodacStaffEmail(user?.email)) redirect(\"/dashboard\")");
    expect(src.indexOf("isGodacStaffEmail(user")).toBeLessThan(src.indexOf("createAdminSupabaseClient()"));
  });
  it("la page est liée depuis le back-office et ses pages voisines", () => {
    for (const f of ["app/godac-staff/page.tsx", "app/godac-staff/go-navigation/page.tsx", "app/godac-staff/usage-essais/page.tsx"]) {
      expect(lire(f), f).toContain("/godac-staff/comptes-essai");
    }
    expect(existsSync("app/godac-staff/comptes-essai/page.tsx")).toBe(true);
  });
  it("la route figure dans la liste des routes sans garderApi (audit-routes)", () => {
    expect(lire("lib/acces/__tests__/audit-routes-lot4.test.ts")).toContain('"app/api/godac-staff/comptes-essai/[id]/route.ts"');
  });
  it("aucun cron ajouté : vercel.json inchangé quant aux fréquences (quotidien au plus)", () => {
    const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];
    expect(crons.some((c) => c.path.includes("comptes-essai"))).toBe(false);
  });
});

describe("accessibilité et mobile de la liste", () => {
  const src = lire("components/godac-staff/ComptesEssaiListe.tsx");
  it("libellés associés, groupe de filtres, annonce du nombre de résultats, erreurs annoncées", () => {
    expect(src).toContain("htmlFor={idRecherche}");
    expect(src).toContain("htmlFor={idMotif}");
    expect(src).toContain('role="group" aria-label="Filtrer par statut"');
    expect(src).toContain("aria-pressed");
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('role="alert"');
    expect(src).toContain('role="status"');
  });
  it("disposition en fiches (pas de tableau à défilement horizontal) et grille adaptative", () => {
    expect(src).not.toContain("<table");
    expect(src).toContain("grid-cols-1");
    expect(src).toContain("sm:grid-cols-2");
  });
  it("les actions passent par la boîte de confirmation GODAC et exigent un motif", () => {
    expect(src).toContain('from "@/lib/ui/confirmation"');
    expect(src).toMatch(/await confirmer\(t\)/);
    expect(src).toContain("normaliserMotif(motif)");
  });
});
