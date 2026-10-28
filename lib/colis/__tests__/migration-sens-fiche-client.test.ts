import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fichier = "supabase/migrations/20261113000001_sens_tournee_fiche_client.sql";
const sql = readFileSync(fichier, "utf8");
// Sans les commentaires : on teste les instructions.
const code = sql.replace(/--.*$/gm, "");

describe("migration 20261113000001 : sens de tournée et fiche client", () => {
  it("passe après la dernière migration existante", () => {
    expect("20261113000001_sens_tournee_fiche_client.sql" > "20261112000001_fin_contrat_suppression.sql").toBe(true);
  });

  it("est additive : aucune instruction destructive ni drop policy / trigger", () => {
    expect(code).not.toMatch(/\bdrop\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\balter\s+table[^;]*\bdrop\b/i);
    expect(code).not.toMatch(/\brename\b/i);
  });

  it("est idempotente : create if not exists, add column if not exists, politiques gardées par pg_policies", () => {
    expect(code).toMatch(/create table if not exists public\.tournee_sens\b/);
    expect(code).toMatch(/create index if not exists/);
    for (const m of code.matchAll(/alter table [\w.]+ add column ([^;]+);/gi)) expect(m[1], m[0]).toMatch(/^if not exists /i);
    for (const m of code.matchAll(/create index (?!if not exists)/gi)) throw new Error(`index non idempotent : ${m[0]}`);
    const policies = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
    expect(policies.length).toBeGreaterThanOrEqual(4);
    for (const p of policies) expect(code, p).toContain(`policyname = '${p}'`);
  });

  it("la nouvelle table est protégée par RLS, limitée à l'organisation, et supprimée avec elle", () => {
    expect(code).toMatch(/alter table public\.tournee_sens enable row level security/);
    expect(code).toMatch(/organization_id uuid not null references public\.organizations \(id\) on delete cascade/);
    // Chaque politique restreint à current_organization_id().
    const bloc = code.slice(code.indexOf("create policy"));
    const politiques = bloc.split("create policy").slice(1);
    expect(politiques).toHaveLength(4);
    for (const p of politiques) expect(p).toContain("organization_id = public.current_organization_id()");
    // Écriture : chauffeurs et encadrement seulement (comme delivery_address_hours).
    for (const p of politiques.filter((x) => !/for select/.test(x))) expect(p).toMatch(/current_role\(\) in \('chauffeur', 'manager_chauffeur'\) or public\.is_manager_like\(\)/);
  });

  it("indexe les recherches (organisation + mise à jour) pour les deux tables", () => {
    expect(code).toMatch(/index if not exists tournee_sens_org_updated_idx on public\.tournee_sens \(organization_id, updated_at\)/);
    expect(code).toMatch(/index if not exists delivery_address_hours_org_updated_idx on public\.delivery_address_hours \(organization_id, updated_at\)/);
  });

  it("étend l'annuaire existant (pas de nouvelle table pour les fiches client)", () => {
    expect([...code.matchAll(/create table if not exists ([\w.]+)/g)].map((m) => m[1])).toEqual(["public.tournee_sens"]);
    for (const col of ["phone", "recipient", "access_notes", "window_start", "window_end", "service_avg_min", "service_samples", "delivered_count", "failed_count", "success_by_hour", "failure_reasons", "contact_message_count", "contact_phone_count", "last_delivery_at"]) {
      expect(code, col).toMatch(new RegExp(`alter table public\\.delivery_address_hours add column if not exists ${col}\\b`));
    }
    expect(code).toMatch(/alter table public\.delivery_stops add column if not exists fiche_enregistree_le timestamptz/);
  });

  it("borne les valeurs stockées (durée 1–30 min, compteurs positifs, JSON typé)", () => {
    expect(code).toMatch(/service_avg_min numeric\(4, 1\) check \(service_avg_min is null or \(service_avg_min >= 1 and service_avg_min <= 30\)\)/);
    expect(code).toMatch(/jsonb_typeof\(success_by_hour\) = 'object'/);
    expect(code).toMatch(/jsonb_typeof\(historique\) = 'array'/);
    expect(code).toMatch(/mode in \('habituel', 'inverse', 'libre'\)/);
  });
});

describe("suppression de l'organisation à la fin du contrat", () => {
  it("toute table portant organization_id de cette migration est supprimée en cascade avec l'organisation", () => {
    // La suppression finale (supprimer_organisation_fin_contrat) efface la ligne organizations ;
    // les tables à clé étrangère « on delete cascade » suivent. Il ne doit donc y avoir aucune clé RESTRICT.
    const tables = [...code.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]!);
    for (const t of tables) {
      const def = code.slice(code.indexOf(t), code.indexOf(");", code.indexOf(t)));
      expect(def, t).toMatch(/references public\.organizations \(id\) on delete cascade/);
    }
    // delivery_address_hours (création : migration 129) est elle aussi en cascade.
    const origine = readFileSync("supabase/migrations/20260101000129_colis_horaires.sql", "utf8");
    expect(origine).toMatch(/organization_id uuid not null references organizations \(id\) on delete cascade/);
  });
});

describe("tolérance à la migration non appliquée", () => {
  it("le code lit les colonnes récentes avec repli, et ignore l'absence de table", () => {
    const serveur = readFileSync("lib/colis/serveur.ts", "utf8");
    expect(serveur).toContain("CLIENT_FIELDS");
    expect(serveur).toMatch(/colonnes = \[[^\]]*CLIENT_FIELDS[^\]]*\]/);
    for (const f of ["lib/colis/sens-serveur.ts", "lib/colis/fiche-client-serveur.ts"]) expect(readFileSync(f, "utf8"), f).toContain("estSchemaManquant");
  });
});
