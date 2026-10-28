import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagePreavis } from "@/lib/fin-contrat/message";
import { listerFichiers, type ClientStockageMinimal } from "@/lib/fin-contrat/stockage";
import { ACTIONS_AUDIT_CONSERVEES, BUCKETS_PAR_ORGANISATION, JOURS_AVANT_SUPPRESSION, JOURS_PREAVIS_MINIMUM } from "@/lib/fin-contrat/regles";

describe("courrier de préavis", () => {
  const m = messagePreavis({ nomOrganisation: "Dupont <script> & Fils", finContrat: new Date("2026-06-01T12:00:00Z"), suppressionPrevue: new Date("2026-08-30T12:00:00Z") });

  it("indique la date de suppression, rappelle l'export et le contact", () => {
    expect(m.subject).toContain("30 août 2026");
    expect(m.html).toContain("supprimées définitivement le 30 août 2026");
    expect(m.html).toContain("exportez-les");
    expect(m.html).toContain("CSV");
    expect(m.html).toContain("contact@godac.fr");
    expect(m.html).toContain("1 juin 2026");
  });

  it("échappe le nom de l'organisation", () => {
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("Dupont &lt;script&gt; &amp; Fils");
  });
});

describe("parcours du stockage", () => {
  function faux(arbre: Record<string, { name: string; id: string | null }[]>, erreurSur?: string): ClientStockageMinimal {
    return {
      async list(chemin, options) {
        if (chemin === erreurSur) return { data: null, error: { message: "boom" } };
        const tout = arbre[chemin] ?? [];
        const debut = options?.offset ?? 0;
        return { data: tout.slice(debut, debut + (options?.limit ?? 1000)), error: null };
      },
    };
  }

  it("liste les fichiers des sous-dossiers, sans les dossiers", async () => {
    const client = faux({
      org1: [{ name: "logo.png", id: "1" }, { name: "2026", id: null }],
      "org1/2026": [{ name: "a.pdf", id: "2" }, { name: "juin", id: null }],
      "org1/2026/juin": [{ name: "b.pdf", id: "3" }],
    });
    expect((await listerFichiers(client, "org1")).sort()).toEqual(["org1/2026/a.pdf", "org1/2026/juin/b.pdf", "org1/logo.png"]);
  });

  it("pagine au-delà de 1000 entrées", async () => {
    const beaucoup = Array.from({ length: 2300 }, (_, i) => ({ name: `f${i}.jpg`, id: String(i) }));
    expect((await listerFichiers(faux({ org1: beaucoup }), "org1")).length).toBe(2300);
  });

  it("une erreur de lecture interrompt tout (rien n'est supprimé à moitié)", async () => {
    await expect(listerFichiers(faux({ org1: [{ name: "d", id: null }] }, "org1/d"), "org1")).rejects.toThrow("boom");
  });

  it("préfixe sans fichier : liste vide", async () => {
    expect(await listerFichiers(faux({}), "org1")).toEqual([]);
  });
});

describe("migration 20261112000001 et code alignés", () => {
  const migration = readFileSync("supabase/migrations/20261112000001_fin_contrat_suppression.sql", "utf8");

  it("passe après 20261111000006 et ne contient aucune instruction destructive hors de la fonction", () => {
    expect("20261112000001_fin_contrat_suppression.sql" > "20261111000006_alerte_planning_fusion_lecture.sql").toBe(true);
    const horsFonction = migration.replace(/create or replace function public\.supprimer_organisation_fin_contrat[\s\S]*?\$function\$;\s*\n(?=\nrevoke)/, "");
    expect(horsFonction).not.toMatch(/\bdelete from\b/i);
    expect(horsFonction).not.toMatch(/\bdrop table\b|\btruncate\b/i);
  });

  it("est idempotente", () => {
    expect(migration).toMatch(/add column if not exists contrat_termine_le/);
    expect(migration).toMatch(/add column if not exists suppression_bloquee boolean not null default false/);
    expect(migration).toMatch(/add column if not exists suppression_bloquee_motif/);
    expect(migration).toMatch(/add column if not exists suppression_bloquee_le/);
    expect(migration).toMatch(/create table if not exists public\.organisations_supprimees\b/);
    expect(migration).toMatch(/drop trigger if exists organizations_guard_fin_contrat/);
    expect(migration).toMatch(/create or replace function/);
  });

  it("les délais de la fonction SQL sont ceux du code", () => {
    expect(migration).toContain(`interval '${JOURS_AVANT_SUPPRESSION} days'`);
    expect(migration).toContain(`interval '${JOURS_PREAVIS_MINIMUM} days'`);
  });

  it("la fonction ne s'exécute qu'avec la clé de service et revérifie démo, blocage, abonnement", () => {
    expect(migration).toMatch(/revoke all on function public\.supprimer_organisation_fin_contrat\(uuid, text\[\]\) from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.supprimer_organisation_fin_contrat\(uuid, text\[\]\) to service_role/);
    for (const garde of ["organisation_demo", "suppression_bloquee", "delai_90_jours_non_ecoule", "preavis_30_jours_non_ecoule", "abonnement_vivant"]) expect(migration).toContain(garde);
  });

  it("le trigger interdit ces colonnes aux utilisateurs de l'entreprise", () => {
    expect(migration).toMatch(/not in \('anon', 'authenticated'\)/);
    expect(migration).toMatch(/new\.suppression_bloquee is distinct from old\.suppression_bloquee/);
    expect(migration).toMatch(/new\.contrat_termine_le is distinct from old\.contrat_termine_le/);
  });

  it("les tables archives sont fermées par RLS sans policy", () => {
    expect(migration).toMatch(/alter table public\.organisations_supprimees enable row level security/);
    expect(migration).toMatch(/alter table public\.organisations_supprimees_journal enable row level security/);
    expect(migration).not.toMatch(/create policy/i);
  });

  it("chaque bucket créé par une migration est couvert par la suppression", () => {
    const ids = new Set<string>();
    for (const f of readdirSync("supabase/migrations")) {
      const sql = readFileSync(`supabase/migrations/${f}`, "utf8");
      for (const m of sql.matchAll(/insert into storage\.buckets[^;]*?values\s*\(\s*'([a-z0-9_-]+)'/gi)) ids.add(m[1]!);
      for (const m of sql.matchAll(/insert into storage\.buckets[^;]*?\)\s*values[\s\S]*?;/gi)) for (const b of m[0].matchAll(/\(\s*'([a-z0-9_-]+)'\s*,\s*'[a-z0-9_-]+'/g)) ids.add(b[1]!);
    }
    expect(ids.size).toBeGreaterThanOrEqual(10);
    for (const id of ids) expect(BUCKETS_PAR_ORGANISATION as readonly string[], `bucket ${id} oublié`).toContain(id);
  });

  it("les tables à clé RESTRICT sont vidées avant l'organisation", () => {
    for (const t of ["fuel_gap_reviews", "fuel_entries", "vehicle_washes", "ticpe_exports"]) {
      expect(migration.indexOf(`delete from public.${t}`), t).toBeGreaterThan(-1);
      expect(migration.indexOf(`delete from public.${t}`)).toBeLessThan(migration.indexOf("delete from public.organizations where id = p_org"));
    }
  });
});

describe("journal d'audit", () => {
  it("toutes les actions conservées existent dans ACTIONS_AUDIT", () => {
    const journal = readFileSync("lib/audit/journal.ts", "utf8");
    for (const a of ACTIONS_AUDIT_CONSERVEES) expect(journal, a).toMatch(new RegExp(`^  ${a}:`, "m"));
  });
});

describe("branchements", () => {
  it("le cron est quotidien, protégé par CRON_SECRET, et DRY-RUN par défaut", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")).crons as { path: string; schedule: string }[];
    const c = vercel.filter((x) => x.path === "/api/cron/fin-contrat");
    expect(c.length).toBe(1);
    expect(c[0]!.schedule).toMatch(/^\d+ \d+ \* \* \*$/);
    const route = readFileSync("app/api/cron/fin-contrat/route.ts", "utf8");
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("Bearer");
    expect(route).not.toContain("garderApi");
    expect(readFileSync("lib/fin-contrat/serveur.ts", "utf8")).toContain("purgeActive()");
  });

  it("le webhook Stripe n'échoue pas si l'enregistrement de la fin de contrat échoue", () => {
    const serveur = readFileSync("lib/fin-contrat/serveur.ts", "utf8");
    const debut = serveur.indexOf("export async function enregistrerFinContratStripe");
    expect(serveur.slice(debut)).toMatch(/try \{[\s\S]*catch \(e\)/);
  });

  it("la route du staff vérifie la liste blanche GODAC avant toute écriture", () => {
    const src = readFileSync("app/api/godac-staff/organisations/[id]/fin-contrat/route.ts", "utf8");
    expect(src.indexOf("isGodacStaffEmail")).toBeLessThan(src.indexOf(".update(maj)"));
  });
});
