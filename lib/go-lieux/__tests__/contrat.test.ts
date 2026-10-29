import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { refusPour, regleEffective } from "@/lib/acces/garde-api";
import { MARQUEUR_GO_NAVIGATION, ecran } from "@/lib/acces/catalogue";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";
import type { UserRole } from "@/lib/types/domain";

const fichier = "20261117000001_go_lieux.sql";
const sql = readFileSync(`supabase/migrations/${fichier}`, "utf8");
const code = sql.replace(/--.*$/gm, "");

describe("migration go_lieux", () => {
  it("passe après la dernière migration existante et n'est pas en doublon de numéro", () => {
    const noms = readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort();
    expect(noms[noms.length - 1]).toBe(fichier);
    expect(noms.filter((n) => n.startsWith("20261117000001"))).toHaveLength(1);
    expect(fichier > "20261116000001_comptes_suspension.sql").toBe(true);
  });
  it("est additive : ni drop, ni delete from, ni truncate, ni update, ni rename", () => {
    expect(code).not.toMatch(/\bdrop\b/i);
    expect(code).not.toMatch(/\bdelete\s+from\b/i);
    expect(code).not.toMatch(/\btruncate\b/i);
    expect(code).not.toMatch(/\bupdate\s+(public\.)?\w+\s+set\b/i);
    expect(code).not.toMatch(/\brename\b/i);
  });
  it("est rejouable : create if not exists, index if not exists, policies gardées par pg_policies", () => {
    expect(code).toMatch(/create table if not exists public\.go_lieux\b/);
    for (const m of code.matchAll(/create (unique )?index (?!if not exists)/gi)) throw new Error(`index non idempotent : ${m[0]}`);
    const policies = [...code.matchAll(/create policy "([^"]+)"/g)].map((m) => m[1]!);
    expect(policies).toHaveLength(4);
    for (const p of policies) expect(code, p).toContain(`policyname = '${p}'`);
  });
  it("cascade vers organizations et users, contraintes check, RLS activée", () => {
    expect(code).toMatch(/user_id uuid not null references public\.users \(id\) on delete cascade/);
    expect(code).toMatch(/organization_id uuid not null references public\.organizations \(id\) on delete cascade/);
    expect(code).toMatch(/genre text not null check \(genre in \('favori', 'recent'\)\)/);
    expect(code).toMatch(/type_lieu in \('domicile', 'travail'\)/);
    expect(code).toMatch(/lat between -90 and 90/);
    expect(code).toMatch(/lng between -180 and 180/);
    expect(code).toMatch(/char_length\(btrim\(libelle\)\) between 1 and 60/);
    expect(code).toMatch(/alter table public\.go_lieux enable row level security/);
    expect(code).toMatch(/dernier_usage timestamptz not null/);
  });
  it("RLS par utilisateur : user_id = auth.uid() sur les 4 policies, aucune ne relit go_lieux", () => {
    const politiques = code.split("create policy").slice(1);
    expect(politiques).toHaveLength(4);
    for (const brut of politiques) {
      const p = brut.slice(brut.indexOf("for "), brut.indexOf(";"));
      expect(p).toContain("user_id = auth.uid()");
      expect(p).toContain("to authenticated");
      // piège « insert … returning » : aucune sous-requête ni fonction qui relit sa propre table
      expect(p).not.toMatch(/from\s+(public\.)?go_lieux/i);
      expect(p).not.toMatch(/\bexists\s*\(/i);
    }
    expect(politiques.filter((p) => /for (select|delete)/.test(p))).toHaveLength(2);
    expect(code).not.toMatch(/create or replace function/i);
  });
  it("index : liste par utilisateur, purge des récents, unicité (dédoublonnage, Domicile/Travail)", () => {
    expect(code).toMatch(/index if not exists go_lieux_user_genre_idx on public\.go_lieux \(user_id, genre, dernier_usage desc\)/);
    expect(code).toMatch(/go_lieux_purge_idx on public\.go_lieux \(dernier_usage\)\s+where genre = 'recent'/);
    expect(code).toMatch(/unique index if not exists go_lieux_unique_lieu_idx\s+on public\.go_lieux \(user_id, genre, cle\)/);
    expect(code).toMatch(/unique index if not exists go_lieux_unique_type_idx\s+on public\.go_lieux \(user_id, type_lieu\)/);
  });
  it("ne stocke aucun trajet ni position : aucune colonne de trace", () => {
    const table = code.slice(code.indexOf("create table"), code.indexOf(");", code.indexOf("create table")));
    expect(table).not.toMatch(/\b(trace|track|trajet|speed|heading|accuracy)\b/i);
  });
});

describe("purge des récents par le cron retention existant", () => {
  it("appelée par purgeExpiredData, 90 jours, jamais les favoris, tolérante à la table absente", () => {
    const purge = readFileSync("lib/retention/purge.ts", "utf8");
    expect(purge).toMatch(/await purgerLieuxRecents\(admin\)/);
    expect(purge).toMatch(/from\("go_lieux"\)\.delete\(\{ count: "exact" \}\)\.eq\("genre", "recent"\)\.lt\("dernier_usage", limiteLieuxRecents\(maintenant\)\)/);
    expect(purge).toContain("goLieuxRecents: GO_LIEUX_RECENTS_JOURS");
    expect(purge).toContain("PGRST205");
  });
  it("aucun nouveau cron et aucun cron plus fréquent que quotidien", () => {
    const crons = (JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.filter((c) => /lieux|go-lieux|aller/i.test(c.path))).toHaveLength(0);
    expect(crons).toHaveLength(16);
    for (const c of crons) {
      const [minute, heure] = c.schedule.split(" ");
      expect(minute, c.path).toMatch(/^\d+$/);
      expect(heure, c.path).toMatch(/^\d+$/);
    }
  });
});

describe("routes /api/go/lieux : garderApi sur chaque handler", () => {
  const routes = ["app/api/go/lieux/route.ts", "app/api/go/lieux/[id]/route.ts"];
  it("chaque handler appelle garderApi({ ecran: \"moi.tournee_colis\" }) et sort si refusé", () => {
    for (const f of routes) {
      const src = readFileSync(f, "utf8");
      const handlers = [...src.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/gm)].map((m) => m[1]!);
      expect(handlers.length, f).toBeGreaterThan(0);
      expect([...src.matchAll(/garderApi\(([^)]*)\)/g)]).toHaveLength(handlers.length);
      for (const m of src.matchAll(/garderApi\(([^)]*)\)/g)) expect(m[1]!.replace(/\s/g, "")).toBe('{ecran:"moi.tournee_colis"}');
      expect((src.match(/if \(!g\.ok\) return g\.reponse;/g) ?? []).length).toBe(handlers.length);
      // Jamais de client service (RLS contournée) ni d'identifiant d'utilisateur lu dans la requête.
      expect(src).not.toMatch(/createAdminSupabaseClient|service_role/);
      expect(src).not.toMatch(/user_id/);
    }
    expect(readFileSync("app/api/go/lieux/route.ts", "utf8").match(/^export async function (\w+)/gm)).toEqual(["export async function GET", "export async function POST", "export async function DELETE"]);
    expect(readFileSync("app/api/go/lieux/[id]/route.ts", "utf8").match(/^export async function (\w+)/gm)).toEqual(["export async function PATCH", "export async function DELETE"]);
  });
  it("toutes les requêtes de lieux sont filtrées sur l'utilisateur connecté", () => {
    const src = readFileSync("lib/go-lieux/serveur.ts", "utf8");
    expect(src).not.toMatch(/createAdminSupabaseClient/);
    for (const m of src.matchAll(/supabase\.from\("go_lieux"\)\.(select|update|delete)[^;]*;/g)) expect(m[0], m[0]).toMatch(/eq\("user_id", userId\)|eq\("id", (existant|ancien)\.id\)\.eq\("user_id", userId\)/);
  });
  it("les nouvelles routes sont couvertes par l'audit des routes (aucune route sans garde)", () => {
    const toutes = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? toutes(join(d, n)) : n === "route.ts" ? [join(d, n)] : []));
    for (const f of toutes("app/api/go")) expect(readFileSync(f, "utf8")).toContain("garderApi(");
  });
});

describe("matrice des rôles : même accès que « Ma tournée colis »", () => {
  const regle = regleEffective({ ecran: "moi.tournee_colis" });
  const avecColis = new Set(["route_optimizer"]);
  const decision = (role: UserRole, modules: ReadonlySet<string>, conduit: boolean) => refusPour(regle, role, modules, conduit);
  it("chauffeur : autorisé", () => expect(decision("chauffeur", avecColis, true)).toBeNull());
  it("manager ou exploitation qui conduit : autorisé ; sans conduite : refusé", () => {
    for (const r of ["manager", "exploitation"] as const) {
      expect(decision(r, avecColis, true), r).toBeNull();
      expect(decision(r, avecColis, false)?.status, r).toBe(403);
    }
  });
  it("direction et comptable : refusés", () => {
    for (const r of ["direction", "comptable"] as const) expect(decision(r, avecColis, false)?.status, r).toBe(403);
  });
  it("module Tournée colis absent (dont essai GO Navigation terminé) : refusé", () => {
    expect(decision("chauffeur", new Set(), true)?.status).toBe(403);
  });
  it("compte d'essai GO Navigation (modules de l'offre) : autorisé", () => {
    expect(decision("chauffeur", new Set(["route_optimizer", "mobile_app", "alerts", "auth_onboarding", "go_navigation"]), true)).toBeNull();
  });
  it("la page applique la garde de « Ma tournée colis » et l'écran d'essai terminé", () => {
    const page = readFileSync("app/livreur/aller-a/page.tsx", "utf8");
    expect(page).toContain('garderPage("moi.tournee_colis")');
    expect(page).toMatch(/essaiTermine\) return <EssaiTermine \/>/);
    expect(ecran("moi.tournee_colis").conducteur).toBe(true);
  });
  it("l'API d'itinéraire reste gardée par le module Tournée colis", () => {
    expect(readFileSync("app/api/colis/itineraire/route.ts", "utf8")).toContain('garderApi({ modules: ["route_optimizer"] })');
  });
});

describe("entrées dans l'application", () => {
  it("l'application chauffeur affiche « Go! » vers /livreur/aller-a", () => {
    const src = readFileSync("components/colis/AppLivreur.tsx", "utf8");
    expect(src).toMatch(/href="\/livreur\/aller-a"/);
  });
  it("barre mobile : l'essai GO Navigation gagne « Go! » ; la barre des chauffeurs (déjà à 4 boutons) n'est pas encombrée", () => {
    const essai = new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION]);
    expect(boutonsBarreMobile("chauffeur", essai, false, true).map((b) => b.href)).toContain("/livreur/aller-a");
    const classique = new Set(["planning", "route_optimizer", "messenger", "fuel_tracking"]);
    const b = boutonsBarreMobile("chauffeur", classique, false, true);
    expect(b).toHaveLength(4);
    expect(b.map((x) => x.href)).not.toContain("/livreur/aller-a");
  });
  it("« Y aller » devient « GO » avec un aria-label « Lancer le guidage vers … »", () => {
    for (const f of ["components/colis/AppLivreur.tsx", "components/colis/GoNavigation.tsx", "components/go-aller-a/EcranDestination.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/Y aller/);
      expect(src, f).toMatch(/aria-label=\{`Lancer le guidage/);
    }
    expect(readFileSync("components/colis/GoNavigation.tsx", "utf8")).toContain("🧭 GO (guidage vers cet arrêt)");
    expect(readFileSync("components/colis/AppLivreur.tsx", "utf8")).toContain("GO avec {libelleNavigation(navPreferee)}");
  });
});

describe("accessibilité et mobile 375 px", () => {
  const ecrans = ["EcranDestination", "EcranArrivee", "EnregistrerFavori", "AllerA"].map((n) => [n, readFileSync(`components/go-aller-a/${n}.tsx`, "utf8")] as const);
  it("cibles tactiles de 44 px au moins, messages annoncés, dialogue modal", () => {
    for (const [n, src] of ecrans) {
      for (const m of src.matchAll(/min-h-\[(\d+)px\]/g)) expect(Number(m[1]), n).toBeGreaterThanOrEqual(44);
      expect(src, n).not.toMatch(/min-h-\[(?:[0-9]|[1-3][0-9]|4[0-3])px\]/);
    }
    const dest = ecrans.find(([n]) => n === "EcranDestination")![1];
    expect(dest).toContain('role="alert"');
    expect(dest).toContain('role="status"');
    expect(dest).toMatch(/h-11 w-11/);
    expect(ecrans.find(([n]) => n === "AllerA")![1]).toContain('aria-modal="true"');
    for (const bouton of ["Monter l'étape", "Descendre l'étape", "Retirer l'étape", "Renommer", "Supprimer"]) expect(dest).toContain(bouton);
  });
  it("aucune largeur fixe supérieure à 375 px : colonne fluide max-w-xl, sans défilement horizontal", () => {
    for (const [n, src] of ecrans) {
      for (const m of src.matchAll(/\bw-\[(\d+)px\]/g)) expect(Number(m[1]), n).toBeLessThanOrEqual(375);
      expect(src, n).not.toMatch(/overflow-x-scroll|whitespace-nowrap/);
    }
    expect(ecrans.find(([n]) => n === "EcranDestination")![1]).toContain("max-w-xl");
  });
  it("textes en français et mentions obligatoires", () => {
    const dest = ecrans.find(([n]) => n === "EcranDestination")![1];
    for (const t of ["Go!", "Ma position actuelle", "Ajouter une étape", "Optimiser l&apos;ordre", "Renommer", "Supprimer", "Tout effacer l&apos;historique", "GO"]) expect(dest).toContain(t);
    const arrivee = ecrans.find(([n]) => n === "EcranArrivee")![1];
    for (const t of ["Vous êtes arrivé", "Ajouter aux favoris", "Nouvelle destination", "Retour à ma tournée"]) expect(arrivee).toContain(t);
  });
});

describe("RGPD : mentions", () => {
  it("confidentialité et DPA citent les lieux enregistrés, les 90 jours et l'absence de trace", () => {
    const conf = readFileSync("app/confidentialite/page.tsx", "utf8");
    expect(conf).toContain("Lieux enregistrés dans GO");
    expect(conf).toMatch(/90 jours après leur dernier usage/);
    expect(conf).toMatch(/Le trajet et votre position ne sont pas\s+enregistrés/);
    const dpa = readFileSync("app/dpa/page.tsx", "utf8");
    expect(dpa).toContain("Lieux enregistrés dans GO");
    expect(dpa).toMatch(/90 jours après leur dernier usage/);
    expect(dpa).toMatch(/Aucun trajet ni position GPS/);
  });
});
