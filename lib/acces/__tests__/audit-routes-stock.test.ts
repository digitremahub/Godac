import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));

import { regleEffective, refusPour } from "@/lib/acces/garde-api";
import { ECRANS, ENCADREMENT, LECTEURS_STOCK, MODULES_AVEC_CODE, PARAMETREURS_STOCK, TOUS_LES_ROLES, deciderAcces, ecran, menuPour, urlDe } from "@/lib/acces/catalogue";
import { boutonsBarreMobile } from "@/lib/acces/barre-mobile";

/**
 * Module Stock : matrice rôle × route et rôle × écran, relue dans le source de chaque
 * route. Une route du stock qui apparaît sans être listée ici fait échouer le test ;
 * une route sans garderApi aussi. Modules actifs sauf mention contraire.
 */
const lire = (f: string) => readFileSync(f, "utf8");
const tout = new Set<string>(MODULES_AVEC_CODE);
const sansStock = new Set<string>([...MODULES_AVEC_CODE].filter((m) => m !== "stock"));
const autorise = (opts: Parameters<typeof regleEffective>[0], role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout, conduit = role === "chauffeur") => refusPour(regleEffective(opts), role, modules, conduit) === null;
const rolesOk = (opts: Parameters<typeof regleEffective>[0], modules: ReadonlySet<string> = tout) => TOUS_LES_ROLES.filter((r) => autorise(opts, r, modules)).sort();

function routes(dossier: string): string[] {
  return readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);
    return statSync(chemin).isDirectory() ? routes(chemin) : nom === "route.ts" ? [chemin] : [];
  });
}
const handlers = (src: string) => [...src.matchAll(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/gm)].map((m) => m[1]!);
/** Texte d'un handler : de sa déclaration à la suivante. */
function corps(src: string, methode: string): string {
  const hs = handlers(src);
  const debut = src.search(new RegExp(`^export async function ${methode}\\b`, "m"));
  const suivant = hs[hs.indexOf(methode) + 1];
  const fin = suivant ? src.search(new RegExp(`^export async function ${suivant}\\b`, "m")) : src.length;
  return src.slice(debut, fin);
}
const normalise = (s: string) => s.replace(/\s+/g, "").replace(/"/g, "");

const LECTURE = "{ roles: LECTEURS_STOCK, modules: [stock] }";
const PARAM = "{ roles: PARAMETREURS_STOCK, modules: [stock] }";
const ENCAD = "{ roles: ENCADREMENT, modules: [stock] }";

/** Garde attendue pour chaque handler de chaque route du stock. */
const ATTENDU: Record<string, Record<string, string>> = {
  "app/api/stock/parametres/route.ts": { GET: LECTURE, PUT: PARAM },
  "app/api/stock/sites/route.ts": { GET: LECTURE, POST: PARAM },
  "app/api/stock/sites/[id]/route.ts": { PATCH: PARAM },
  "app/api/stock/emplacements/route.ts": { POST: PARAM },
  "app/api/stock/emplacements/[id]/route.ts": { PATCH: PARAM },
  "app/api/stock/articles/route.ts": { GET: LECTURE, POST: PARAM },
  "app/api/stock/articles/[id]/route.ts": { PATCH: PARAM },
  "app/api/stock/unites/route.ts": { GET: LECTURE },
  "app/api/stock/mouvements/route.ts": { GET: LECTURE, POST: LECTURE },
  "app/api/stock/mouvements/export/route.ts": { GET: LECTURE },
  "app/api/stock/inventaires/route.ts": { GET: LECTURE, POST: ENCAD },
  "app/api/stock/inventaires/[id]/route.ts": { GET: LECTURE },
  "app/api/stock/inventaires/[id]/comptage/route.ts": { POST: LECTURE },
  "app/api/stock/inventaires/[id]/validation/route.ts": { POST: ENCAD },
};

describe("routes du stock : une garderApi par handler, avec les bons rôles et le module", () => {
  it("aucune route du stock n'échappe à ce test", () => {
    const presentes = routes("app/api/stock").sort();
    expect(presentes).toEqual(Object.keys(ATTENDU).sort());
  });

  for (const [fichier, parMethode] of Object.entries(ATTENDU)) {
    it(fichier, () => {
      const src = lire(fichier);
      expect(handlers(src).sort(), "handlers exportés").toEqual(Object.keys(parMethode).sort());
      for (const [methode, attendu] of Object.entries(parMethode)) {
        const c = corps(src, methode);
        const gardes = [...c.matchAll(/garderApi\(([^)]*)\)/g)].map((m) => normalise(m[1]!));
        expect(gardes, `${methode} : une seule garde`).toEqual([normalise(attendu)]);
        // La garde est la première chose faite et un refus sort tout de suite.
        expect(c.indexOf("if (!g.ok) return g.reponse;"), `${methode} : refus immédiat`).toBeGreaterThan(c.indexOf("garderApi("));
        expect(c.slice(0, c.indexOf("await garderApi(")).includes("await"), `${methode} : rien avant la garde`).toBe(false);
      }
    });
  }

  it("les constantes de rôles utilisées par les routes sont celles du catalogue", () => {
    for (const f of Object.keys(ATTENDU)) {
      const src = lire(f);
      if (src.includes("LECTEURS_STOCK") || src.includes("PARAMETREURS_STOCK") || src.includes("ENCADREMENT")) {
        expect(src, f).toMatch(/import \{[^}]*\} from "@\/lib\/acces\/catalogue";/);
      }
    }
  });

  it("le cron est quotidien, protégé par CRON_SECRET et listé comme route sans garderApi", () => {
    const cron = lire("app/api/cron/stock/route.ts");
    expect(cron).toMatch(/process\.env\.CRON_SECRET/);
    expect(cron).toMatch(/authorization"\) !== `Bearer \$\{secret\}`/);
    const vercel = JSON.parse(lire("vercel.json")) as { crons: { path: string; schedule: string }[] };
    const entree = vercel.crons.filter((c) => c.path === "/api/cron/stock");
    expect(entree).toHaveLength(1);
    const [min, heure, jour, mois, semaine] = entree[0]!.schedule.split(" ");
    expect([jour, mois, semaine]).toEqual(["*", "*", "*"]);
    expect(min).toMatch(/^\d+$/);
    expect(heure).toMatch(/^\d+$/);
  });

  it("aucun cron du dépôt n'est plus fréquent qu'une fois par jour", () => {
    const vercel = JSON.parse(lire("vercel.json")) as { crons: { path: string; schedule: string }[] };
    for (const c of vercel.crons) {
      const [min, heure] = c.schedule.split(" ");
      expect(min, c.path).toMatch(/^\d+$/);
      expect(heure, c.path).toMatch(/^\d+$/);
    }
  });
});

describe("matrice rôle × route", () => {
  it("lecture, mouvements, comptage, historique, export : chauffeur, manager, exploitation, direction ; jamais le comptable", () => {
    expect(rolesOk({ roles: LECTEURS_STOCK, modules: ["stock"] })).toEqual(["chauffeur", "direction", "exploitation", "manager"]);
    expect(autorise({ roles: LECTEURS_STOCK, modules: ["stock"] }, "comptable")).toBe(false);
  });
  it("paramétrage (profils, dépôts, emplacements, articles, seuils) : exploitation et direction", () => {
    expect(rolesOk({ roles: PARAMETREURS_STOCK, modules: ["stock"] })).toEqual(["direction", "exploitation"]);
  });
  it("ouverture et validation d'un inventaire : manager, exploitation, direction ; jamais le chauffeur ni le comptable", () => {
    expect(rolesOk({ roles: ENCADREMENT, modules: ["stock"] })).toEqual(["direction", "exploitation", "manager"]);
  });
  it("module Stock non activé : tout est refusé (403), même à la direction", () => {
    for (const opts of [{ roles: LECTEURS_STOCK, modules: ["stock"] as const }, { roles: PARAMETREURS_STOCK, modules: ["stock"] as const }, { roles: ENCADREMENT, modules: ["stock"] as const }]) {
      expect(rolesOk(opts, sansStock)).toEqual([]);
      const refus = refusPour(regleEffective(opts), "direction", sansStock);
      expect(refus?.status).toBe(403);
    }
  });
  it("un rôle refusé reçoit 403 et le message nomme les rôles autorisés", async () => {
    const refus = refusPour(regleEffective({ roles: LECTEURS_STOCK, modules: ["stock"] }), "comptable", tout);
    expect(refus?.status).toBe(403);
    const corps = await refus!.json();
    expect(corps.code).toBe("ROLE_REFUSE");
    expect(corps.rolesAutorises).toEqual(["chauffeur", "manager", "exploitation", "direction"]);
  });
});

describe("matrice rôle × écran du stock", () => {
  const ECRANS_STOCK = ECRANS.filter((e) => e.id.startsWith("stock."));
  const ouverts = (role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout) => ECRANS_STOCK.filter((e) => deciderAcces(e, role, modules, role === "chauffeur").ok).map((e) => e.id);

  it("six écrans, tous sous Exploitation › Stock", () => {
    expect(ECRANS_STOCK.map((e) => e.id)).toEqual(["stock.accueil", "stock.mouvement", "stock.liste", "stock.historique", "stock.inventaire", "stock.parametres"]);
    expect(ECRANS_STOCK.every((e) => e.href.startsWith("/exploitation/stock"))).toBe(true);
    expect(ECRANS_STOCK.every((e) => e.section === "exploitation")).toBe(true);
    expect(ECRANS_STOCK.every((e) => (e.modules ?? []).includes("stock"))).toBe(true);
  });
  it("chauffeur et manager : tout sauf les paramètres", () => {
    for (const role of ["chauffeur", "manager"] as const) expect(ouverts(role)).toEqual(["stock.accueil", "stock.mouvement", "stock.liste", "stock.historique", "stock.inventaire"]);
  });
  it("exploitation et direction : tout, paramètres compris", () => {
    for (const role of ["exploitation", "direction"] as const) expect(ouverts(role)).toHaveLength(6);
  });
  it("comptable : aucun écran du stock", () => {
    expect(ouverts("comptable")).toEqual([]);
  });
  it("module non activé : aucun écran, pour aucun rôle", () => {
    for (const role of TOUS_LES_ROLES) expect(ouverts(role, sansStock), role).toEqual([]);
  });
  it("les écrans suivent les droits des routes (jamais plus ouverts que l'API)", () => {
    expect(ecran("stock.parametres").roles).toEqual(PARAMETREURS_STOCK);
    for (const id of ["stock.accueil", "stock.mouvement", "stock.liste", "stock.historique", "stock.inventaire"]) expect(ecran(id).roles).toEqual(LECTEURS_STOCK);
  });
  it("menu : une entrée « Stock » pour les lecteurs, les autres écrans en sous-onglets", () => {
    const dansLeMenu = (role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout) => menuPour(role, modules, role === "chauffeur").flatMap((s) => s.ecrans.map((e) => e.id)).filter((id) => id.startsWith("stock."));
    for (const role of ["chauffeur", "manager", "exploitation", "direction"] as const) expect(dansLeMenu(role), role).toEqual(["stock.accueil"]);
    expect(dansLeMenu("comptable")).toEqual([]);
    expect(dansLeMenu("direction", sansStock)).toEqual([]);
  });
  it("URL de l'écran d'accueil", () => {
    expect(urlDe("stock.accueil")).toBe("/exploitation/stock");
  });
  it("le module est dans la liste des modules avec code", () => {
    expect(MODULES_AVEC_CODE).toContain("stock");
  });
  it("la barre mobile du chauffeur ne change pas (le stock est dans « Plus »)", () => {
    const sans = boutonsBarreMobile("chauffeur", sansStock, false).map((b) => b.href);
    const avec = boutonsBarreMobile("chauffeur", tout, false).map((b) => b.href);
    expect(avec).toEqual(sans);
  });
});

describe("chaque page du stock existe et se garde par son écran", () => {
  for (const e of ECRANS.filter((x) => x.id.startsWith("stock."))) {
    it(e.href, () => {
      const fichier = `app/(dashboard)${e.href}/page.tsx`;
      const src = lire(fichier);
      expect(src).toContain(`garderPage("${e.id}")`);
      expect(src).toMatch(/if \(!g\.ok\) return g\.ecran;/);
    });
  }
});

describe("la tolérance de l'intégration colis", () => {
  const appels = [
    ["app/api/colis/tournees/[id]/route.ts", ["stockAuDepartTournee", "stockApresCloture"]],
    ["app/api/colis/arrets/[id]/route.ts", ["stockApresArret"]],
    ["app/api/colis/arrets/[id]/livraison/route.ts", ["stockApresArret"]],
  ] as const;
  for (const [fichier, fonctions] of appels) {
    it(`${fichier} appelle ${fonctions.join(", ")} après l'action colis, sans try/catch à gérer`, () => {
      const src = lire(fichier);
      for (const f of fonctions) {
        expect(src).toContain(`${f}(`);
        // Appelé avec await mais jamais dans une condition de réussite de la réponse.
        expect(src).toMatch(new RegExp(`await ${f}\\(`));
      }
    });
  }
  it("les fonctions d'intégration attrapent toute erreur", () => {
    const src = lire("lib/stock/integration-tournee.ts");
    for (const f of ["stockAuDepartTournee", "stockApresArret", "stockApresCloture"]) {
      const debut = src.indexOf(`export async function ${f}`);
      const corps = src.slice(debut, src.indexOf("\n}\n", debut));
      expect(corps, f).toContain("try {");
      expect(corps, f).toMatch(/catch \(e\)/);
      expect(corps, f).not.toMatch(/throw /);
    }
  });
});
