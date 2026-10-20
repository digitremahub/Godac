import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ECRANS } from "@/lib/acces/catalogue";

interface Regle {
  source: string;
  destination: string;
  has?: { type: "query"; key: string; value?: string }[];
}

const RACINE = path.resolve(__dirname, "../../..");
const APP = path.join(RACINE, "app");
const REGLES: Regle[] = JSON.parse(readFileSync(path.join(RACINE, "config/redirections.json"), "utf8"));

/** Toutes les routes de pages de l'application (groupes `(x)` retirés). */
function routes(dir = APP): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === "api" && dir === APP ? [] : routes(p);
    if (n !== "page.tsx") return [];
    const segs = path
      .relative(APP, path.dirname(p))
      .split(path.sep)
      .filter((s) => s && !/^\(.*\)$/.test(s));
    return ["/" + segs.join("/")];
  });
}
const ROUTES = routes();
const regexRoute = (r: string) => new RegExp("^" + r.replace(/\[[^\]]+\]/g, "[^/]+") + "$");
const PAGES = ROUTES.map(regexRoute);
const pageExiste = (chemin: string) => PAGES.some((re) => re.test(chemin));

/** Applique les redirections à une URL (première règle qui correspond, comme Next). */
function rediriger(url: string): string | null {
  const u = new URL(url, "http://x");
  for (const r of REGLES) {
    const noms: string[] = [];
    const re = new RegExp("^" + r.source.replace(/:(\w+)/g, (_, n: string) => (noms.push(n), "([^/]+)")) + "$");
    const m = u.pathname.match(re);
    if (!m) continue;
    if (r.has && !r.has.every((h) => (h.value === undefined ? u.searchParams.has(h.key) : u.searchParams.get(h.key) === h.value))) continue;
    let dest = r.destination;
    noms.forEach((n, i) => (dest = dest.replace(`:${n}`, m[i + 1]!)));
    const d = new URL(dest, "http://x");
    u.searchParams.forEach((v, k) => {
      if (!d.searchParams.has(k)) d.searchParams.set(k, v);
    });
    return d.pathname + d.search;
  }
  return null;
}

/** URL qui ne doivent jamais être redirigées (§ 4.1). */
const FIGEES = [/^\/dashboard$/, /^\/account/, /^\/livreur/, /^\/scan\//, /^\/driver-pin/, /^\/join/, /^\/prestataire/, /^\/api\//, /^\/sign-/, /^\/onboarding/, /^\/v\//, /^\/$/];

/** Anciennes adresses de l'espace connecté (plan § 4.2), avec leurs variantes de requête. */
const ANCIENNES = [
  // Carburant
  "/fuel",
  "/fuel?new=1&vehicle=123",
  "/ocr-review",
  "/tanks",
  "/tanks?tab=approvisionnements",
  "/ticpe",
  "/ticpe/42",
  // Flotte
  "/vehicles",
  "/vehicles/new",
  "/vehicles/123",
  "/maintenance",
  "/maintenance?vehicle=123",
  "/loueurs/demandes",
  "/loueurs/demandes?statut=a_valider",
  "/loueurs",
  "/fines",
  "/qr-codes",
  // Mon espace
  "/tours/start",
  "/tours/start?vehicle=123",
  "/tours/end",
  "/tours/help",
  "/planning/mine",
  "/planning/mine?entry=abc",
  "/my-vehicle",
  "/mes-amendes",
  "/my-fines",
  "/payslips",
  "/time-clock",
  "/leaves",
  // Exploitation
  "/planning",
  "/planning?view=week&week=2026-10-19",
  "/tours/routes",
  "/colis",
  "/colis?onglet=historique",
  "/suivi",
  "/tours/history",
  "/reports",
  "/reports?view=photos",
  "/contestations",
];

describe("redirections des anciennes adresses", () => {
  it("chaque ancienne adresse mène à une page existante", () => {
    for (const ancienne of ANCIENNES) {
      const dest = rediriger(ancienne);
      expect(dest, `${ancienne} n'est pas redirigée`).not.toBeNull();
      expect(pageExiste(dest!.split("?")[0]!), `${ancienne} → ${dest} : aucune page`).toBe(true);
    }
  });

  it("la requête est conservée et les règles `has` passent avant la règle générale", () => {
    expect(rediriger("/fuel?new=1&vehicle=123")).toBe("/carburant/pleins?new=1&vehicle=123");
    expect(rediriger("/tanks?tab=approvisionnements")?.startsWith("/carburant/approvisionnements")).toBe(true);
    expect(rediriger("/vehicles/new")).toBe("/flotte/vehicules/nouveau");
    expect(rediriger("/colis?onglet=historique")?.startsWith("/exploitation/historique/colis")).toBe(true);
    expect(rediriger("/reports?view=photos")?.startsWith("/exploitation/historique/photos")).toBe(true);
    expect(rediriger("/planning/mine?entry=abc")).toBe("/moi/planning?entry=abc");
    expect(rediriger("/vehicles/abc")).toBe("/flotte/vehicules/abc");
    for (const [i, r] of REGLES.entries()) {
      if (r.has) continue;
      const tardive = REGLES.slice(i + 1).find((x) => x.source === r.source && x.has);
      expect(tardive, `${r.source} : la règle « has » doit précéder la règle générale`).toBeUndefined();
    }
  });

  it("aucune boucle, aucune adresse figée redirigée, aucune page masquée", () => {
    for (const r of REGLES) {
      expect(FIGEES.some((re) => re.test(r.source)), `${r.source} est figée`).toBe(false);
      const dest = r.destination.split("?")[0]!.replace(/:(\w+)/g, "x");
      expect(rediriger(dest), `${r.source} → ${dest} redirige encore`).toBeNull();
      expect(pageExiste(dest), `${r.destination} : aucune page`).toBe(true);
      // Une page encore présente à l'ancienne adresse serait masquée par la redirection.
      expect(pageExiste(r.source.replace(/:(\w+)/g, "x")), `${r.source} : l'ancienne page existe encore`).toBe(false);
    }
  });
});

describe("catalogue ↔ pages", () => {
  it("chaque écran du catalogue a une page à son adresse", () => {
    for (const e of ECRANS) {
      const chemin = e.href.split(/[?#]/)[0]!;
      expect(ROUTES, `${e.id} → ${e.href}`).toContain(chemin);
    }
  });

  it("les alternatives par rôle mènent à des pages existantes", () => {
    for (const e of ECRANS) for (const alt of Object.values(e.alternative ?? {})) expect(pageExiste(alt!.split("?")[0]!), `${e.id} → ${alt}`).toBe(true);
  });
});
