import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Lot 4 « sécurité / performance / fiabilité » : tests de contrat des routes
 * critiques. Comme audit-routes-lot1/2, ils relisent le source de chaque route :
 * chaque handler exporté doit passer par garderApi avec les bons rôles/modules,
 * et aucune route ne doit s'ouvrir sans que ce test le dise.
 */
const lire = (f: string) => readFileSync(f, "utf8");
const handlers = (src: string) => [...src.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/gm)].map((m) => m[1]!);
const gardes = (src: string) => [...src.matchAll(/garderApi\(([^)]*)\)/g)].map((m) => m[1]!.trim());

function routes(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) return routes(chemin);
    return nom === "route.ts" ? [chemin] : [];
  });
}

describe("routes critiques : un garderApi par handler, avec les bons rôles / modules", () => {
  const colis = { modules: ["route_optimizer"] };
  const attendu: Record<string, string> = {
    "app/api/colis/arrets/route.ts": JSON.stringify(colis),
    "app/api/colis/arrets/[id]/route.ts": JSON.stringify(colis),
    "app/api/colis/arrets/[id]/livraison/route.ts": JSON.stringify(colis),
    "app/api/colis/arrets/bulk/route.ts": JSON.stringify(colis),
    "app/api/colis/tournees/route.ts": JSON.stringify(colis),
    "app/api/colis/tournees/[id]/route.ts": JSON.stringify(colis),
    "app/api/colis/trace/route.ts": JSON.stringify(colis),
    "app/api/colis/position/route.ts": JSON.stringify(colis),
    "app/api/colis/optimiser/route.ts": JSON.stringify(colis),
    "app/api/colis/bordereau/route.ts": JSON.stringify(colis),
    "app/api/colis/etiquette/route.ts": JSON.stringify(colis),
    "app/api/colis/affectations/route.ts": JSON.stringify(colis),
    "app/api/time-clock/route.ts": JSON.stringify({ modules: ["time_clock"] }),
    "app/api/fuel-entries/route.ts": JSON.stringify({ roles: "tous" }),
    "app/api/fuel-entries/[id]/route.ts": JSON.stringify({ roles: "tous" }),
    "app/api/fuel-entries/export/route.ts": "{ roles: ROLES_EXPORT_PLEINS }",
    "app/api/ocr/tour-report/process/route.ts": JSON.stringify({ roles: "tous" }),
  };
  const normalise = (s: string) => s.replace(/\s+/g, "").replace(/"/g, "").replace(/'/g, "");

  for (const [fichier, options] of Object.entries(attendu)) {
    it(fichier, () => {
      const src = lire(fichier);
      const g = gardes(src);
      expect(g.length, "garderApi absent").toBeGreaterThanOrEqual(1);
      // Chaque handler exporté appelle garderApi, directement ou par la fonction de contexte du fichier.
      for (const [i, handler] of handlers(src).entries()) {
        const debut = src.search(new RegExp(`^export async function ${handler}\\b`, "m"));
        const fin = handlers(src)[i + 1] ? src.search(new RegExp(`^export async function ${handlers(src)[i + 1]}\\b`, "m")) : src.length;
        expect(/garderApi\(|await contexte\(/.test(src.slice(debut, fin)), `${handler} sans garde`).toBe(true);
      }
      for (const opts of g) expect(normalise(opts)).toBe(normalise(options));
      // Une garde refusée sort tout de suite.
      expect((src.match(/if \(!g2?\.ok\) return g2?\.reponse;|if \(!g\.ok\) return \{ erreur: g\.reponse \}/g) ?? []).length).toBeGreaterThanOrEqual(g.length);
    });
  }

  it("aucun handler colis ne rappelle moduleActif en doublon de garderApi sans passer par le cache de la garde", () => {
    // moduleActif reste appelé par les handlers, mais lit d'abord le résultat mémorisé par garderApi.
    const serveur = lire("lib/colis/serveur.ts");
    expect(serveur).toMatch(/moduleDejaVerifie\(organizationId, "route_optimizer"\)/);
    expect(lire("lib/acces/garde-api.ts")).toMatch(/memoriserModule\(appUser\.organization_id/);
  });
});

describe("aucune route API ne s'ouvre sans garde", () => {
  // Routes volontairement sans garderApi : publiques (limitées par IP), cron
  // (secret), webhooks (signature), authentification, outils du personnel
  // GODAC (requireStaff), ou gardées par un autre assistant (requireAppUser, rôle).
  const SANS_GARDERAPI = new Set([
    "app/api/entreprise/recherche/route.ts",
    "app/api/partage-go/lien/route.ts",
    "app/api/partage-go/invitations/route.ts",
    "app/api/partage-go/invitations/[id]/route.ts",
    "app/api/client-errors/route.ts",
    "app/api/godac-staff/users/[id]/route.ts",
    "app/api/godac-staff/support-requests/[id]/route.ts",
    "app/api/godac-staff/ticpe/bareme/route.ts",
    "app/api/godac-staff/ticpe/bareme/[id]/route.ts",
    "app/api/godac-staff/go-navigation/invitations/route.ts",
    "app/api/godac-staff/go-navigation/invitations/[id]/route.ts",
    "app/api/godac-staff/recommandations/[id]/route.ts",
    "app/api/planning/entries/[id]/reconciliation/route.ts",
    "app/api/planning/entries/[id]/fusion/route.ts",
    "app/api/planning/entries/[id]/repartition/route.ts",
    "app/api/auth/passkey/route.ts",
    "app/api/auth/passkey/[id]/route.ts",
    "app/api/auth/passkey/register/options/route.ts",
    "app/api/auth/passkey/register/verify/route.ts",
    "app/api/auth/passkey/login/options/route.ts",
    "app/api/auth/passkey/login/verify/route.ts",
    "app/api/auth/driver-pin/[id]/recover/route.ts",
    "app/api/auth/driver-pin/[id]/login/route.ts",
    "app/api/auth/driver-pin/[id]/set/route.ts",
    "app/api/auth/driver-pin/login/route.ts",
    "app/api/public/demo-request/route.ts",
    "app/api/public/go-navigation/inscription/route.ts",
    "app/api/public/driver-signup/route.ts",
    "app/api/public/prestataire/[token]/route.ts",
    "app/api/cron/reset-demo/route.ts",
    "app/api/cron/retention/route.ts",
    "app/api/cron/fin-contrat/route.ts",
    "app/api/godac-staff/organisations/[id]/fin-contrat/route.ts",
    "app/api/cron/surveillance-tournees/route.ts",
    "app/api/cron/loueurs/route.ts",
    "app/api/cron/ticpe/route.ts",
    "app/api/cron/usage-billing/route.ts",
    "app/api/cron/paliers/route.ts",
    "app/api/cron/weekly-planning-digest/route.ts",
    "app/api/cron/echeances-flotte/route.ts",
    "app/api/cron/rh-quotidien/route.ts",
    "app/api/cron/daily-planning-reminder/route.ts",
    "app/api/cron/planning-semaine-suivante/route.ts",
    "app/api/cron/planning-envoi-auto/route.ts",
    "app/api/csp-report/route.ts",
    "app/api/geo/search/route.ts",
    "app/api/webhooks/supabase-alerts/route.ts",
    "app/api/webhooks/stripe/route.ts",
    "app/api/onboarding/modules/route.ts",
    "app/api/onboarding/tanks/route.ts",
    "app/api/onboarding/create-organization/route.ts",
  ]);

  it("toute nouvelle route API appelle garderApi, ou rejoint la liste ci-dessus après relecture", () => {
    const sansGarde = routes("app/api").filter((f) => !lire(f).includes("garderApi(")).sort();
    const nouvelles = sansGarde.filter((f) => !SANS_GARDERAPI.has(f));
    expect(nouvelles, "route sans garderApi : ajoutez la garde (rôles + modules)").toEqual([]);
  });
});

describe("limiteur de débit des endpoints publics", () => {
  it.each([
    ["app/api/auth/passkey/login/options/route.ts", "passkeyOptions"],
    ["app/api/auth/passkey/login/verify/route.ts", "passkeyVerify"],
    ["app/api/auth/driver-pin/login/route.ts", "connexionPin"],
    ["app/api/auth/driver-pin/[id]/login/route.ts", "connexionPin"],
    ["app/api/auth/driver-pin/[id]/recover/route.ts", "recuperationPin"],
    ["app/api/auth/driver-pin/[id]/set/route.ts", "recuperationPin"],
    ["app/api/public/driver-signup/route.ts", "inscriptionChauffeur"],
    ["app/api/public/demo-request/route.ts", "demandeDemo"],
    ["app/api/client-errors/route.ts", "erreursClient"],
  ])("%s est limitée par IP", (fichier, regle) => {
    const src = lire(fichier);
    expect(src).toContain(`limiterParIp(req, REGLES_LIMITE.${regle})`);
    // La limite est la première chose faite : avant toute lecture du corps.
    expect(src.indexOf("limiterParIp(")).toBeLessThan(src.indexOf("req.json()") === -1 ? Infinity : src.indexOf("req.json()"));
  });

  it("le challenge passkey est signé et consommé une fois (login et enregistrement)", () => {
    for (const f of ["app/api/auth/passkey/login/verify/route.ts", "app/api/auth/passkey/register/verify/route.ts"]) expect(lire(f), f).toContain("consommerChallenge(cookieStore)");
    for (const f of ["app/api/auth/passkey/login/options/route.ts", "app/api/auth/passkey/register/options/route.ts"]) expect(lire(f), f).toContain("cookieChallengeSigne(options.challenge)");
  });
});

describe("fiabilité : filets d'erreur et configuration", () => {
  it("error.tsx pour la racine, /livreur et l'espace connecté, et global-error", () => {
    for (const f of ["app/error.tsx", "app/global-error.tsx", "app/livreur/error.tsx", "app/(dashboard)/error.tsx", "app/(dashboard)/dashboard/error.tsx"]) expect(existsSync(f), f).toBe(true);
    expect(lire("app/livreur/error.tsx")).toContain('origine="livreur"');
    expect(lire("components/shared/EcranErreur.tsx")).toContain("Réessayer");
    expect(lire("middleware.ts")).toContain('"/api/client-errors"');
  });

  it("les copies de travail .claude/worktrees sont exclues de tsc et de vitest", () => {
    expect(JSON.parse(lire("tsconfig.json")).exclude).toContain(".claude/worktrees");
    expect(lire("vitest.config.ts")).toContain(".claude/worktrees/**");
  });

  it("plan Vercel Hobby : aucun cron plus fréquent qu'une fois par jour", () => {
    const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];
    for (const c of crons) {
      const [minute, heure] = c.schedule.split(" ");
      expect(minute, c.path).toMatch(/^\d+$/);
      expect(heure, c.path).toMatch(/^\d+$/);
    }
  });

  it("le service worker ne met en cache que /_next/static (pas de mode hors ligne des pages)", () => {
    const sw = lire("public/sw.js");
    expect(sw).toContain('url.pathname.startsWith("/_next/static/")');
    expect(sw).toContain('req.method !== "GET"');
  });

  it("la file hors ligne est rejouée sous verrou entre onglets", () => {
    expect(lire("lib/offline/outbox.ts")).toContain("avecVerrouRejeu(rejouerFile");
  });
});
