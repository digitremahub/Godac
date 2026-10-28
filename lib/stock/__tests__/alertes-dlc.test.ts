import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => null }));

import { alerterEcartInventaire, synchroniserAlertesDlc, synchroniserAlertesNonRentre, synchroniserAlertesSeuil } from "@/lib/stock/alertes-serveur";
import { TYPES_ALERTE_STOCK } from "@/lib/stock/alertes";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const ORG = "o1";
const parametres = (actifs: string[], profils: Record<string, unknown> = {}) => ({ organization_id: ORG, profils: ["vrac"], prefixe_code: null, format_etiquette: null, profils_config: { version: 1, actifs, profils } });
const article = (id: string, profil: string | null, p: Record<string, unknown> = {}) => ({ id, organization_id: ORG, code: `R-${id}`, nom: `Article ${id}`, unite: "pièce", seuil_mini: 0, actif: true, profil, ...p });
const solde = (article_id: string, lot: string, dlc: string | null, quantite = 4) => ({ organization_id: ORG, article_id, site_id: "s1", emplacement_id: null, lot, dlc, quantite });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.useRealTimers());

describe("alertes « DLC proche » (cron quotidien)", () => {
  it("le type est listé avec les autres types d'alerte du stock", () => {
    expect(TYPES_ALERTE_STOCK).toEqual(["stock_seuil", "stock_ecart", "stock_non_rentre", "stock_dlc_proche"]);
  });

  it("une alerte par lot proche de sa DLC, sans service, pour la direction et l'exploitation ; le lot lointain n'alerte pas", async () => {
    const db = fakeDb({
      stock_parametres: [parametres(["alimentaire", "pharmacie"])],
      stock_articles: [article("a1", "alimentaire"), article("a2", "pharmacie")],
      stock_soldes: [solde("a1", "L1", "2026-11-02"), solde("a1", "L2", "2026-12-30"), solde("a2", "P1", "2027-01-10")],
      stock_unites: [],
      alerts: [],
    });
    const bilan = await synchroniserAlertesDlc(db as never, ORG);
    expect(bilan).toMatchObject({ creees: 2, closes: 0, typeAbsent: false, erreur: null });
    const alertes = db.ligne("alerts");
    expect(alertes.map((a) => a.cle_dedoublonnage).sort()).toEqual(["stock:dlc:a1:L1", "stock:dlc:a2:P1"]);
    expect(alertes[0]).toMatchObject({ type: "stock_dlc_proche", related_table: "stock_articles", service_id: null });
    expect(alertes[0]!.recipient_roles).toEqual(["direction", "exploitation", "manager"]);
    expect(alertes.find((a) => a.related_id === "a1")!.message).toContain("DLC proche : Article a1 (R-a1), lot L1");
  });

  it("deuxième passage : pas de doublon ; lot épuisé : alerte close ; revenu dans le délai : rouverte", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["alimentaire"])], stock_articles: [article("a1", "alimentaire")], stock_soldes: [solde("a1", "L1", "2026-11-02")], stock_unites: [], alerts: [] });
    await synchroniserAlertesDlc(db as never, ORG);
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(0);
    expect(db.ligne("alerts")).toHaveLength(1);
    db.ligne("stock_soldes")[0]!.quantite = 0;
    expect((await synchroniserAlertesDlc(db as never, ORG)).closes).toBe(1);
    expect(db.ligne("alerts")[0]!.status).toBe("resolved");
    db.ligne("stock_soldes")[0]!.quantite = 3;
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(1);
    expect(db.ligne("alerts")).toHaveLength(1);
    expect(db.ligne("alerts")[0]!.status).toBe("open");
  });

  it("délai réglé par l'entreprise : J-2 ne signale pas une DLC dans 5 jours", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["alimentaire"], { alimentaire: { alertes: { dlc_jours: 2 } } })], stock_articles: [article("a1", "alimentaire")], stock_soldes: [solde("a1", "L1", "2026-11-02")], stock_unites: [], alerts: [] });
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(0);
  });

  it("alerte désactivée pour le profil : rien n'est créé", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["alimentaire"], { alimentaire: { alertes: { dlc_jours: null } } })], stock_articles: [article("a1", "alimentaire")], stock_soldes: [solde("a1", "L1", "2026-10-20")], stock_unites: [], alerts: [] });
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(0);
  });

  it("DLC dépassée : alerte créée", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["alimentaire"])], stock_articles: [article("a1", "alimentaire")], stock_soldes: [solde("a1", "L1", "2026-10-20")], stock_unites: [], alerts: [] });
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(1);
    expect(db.ligne("alerts")[0]!.message).toContain("dépassée depuis 8 jours");
    expect(db.ligne("alerts")[0]!.severity).toBe("warning");
  });

  it("unités individualisées : une alerte récapitulative, close quand plus aucune n'est concernée", async () => {
    const db = fakeDb({
      stock_parametres: [parametres(["sante"])],
      stock_articles: [],
      stock_soldes: [],
      stock_unites: [{ organization_id: ORG, profil: "sante", dlc: "2026-10-29", statut: "dans_depot" }, { organization_id: ORG, profil: "sante", dlc: "2026-10-30", statut: "dans_depot" }],
      alerts: [],
    });
    expect((await synchroniserAlertesDlc(db as never, ORG)).creees).toBe(1);
    expect(db.ligne("alerts")[0]).toMatchObject({ cle_dedoublonnage: "stock:dlc:unites", related_table: "stock_unites", related_id: ORG });
    expect(db.ligne("alerts")[0]!.message).toContain("2 unités en stock ont une date limite");
    db.ligne("stock_unites").forEach((u) => (u.statut = "livre"));
    expect((await synchroniserAlertesDlc(db as never, ORG)).closes).toBe(1);
  });

  it("migrations des codes pas appliquées (colonnes absentes) : aucune alerte, aucune erreur", async () => {
    const db = fakeDb({ alerts: [] });
    expect(await synchroniserAlertesDlc(db as never, ORG)).toEqual({ creees: 0, closes: 0, typeAbsent: false, erreur: null });
  });

  it("type d'alerte absent de l'enum : rien n'est créé, le bilan le dit", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["alimentaire"])], stock_articles: [article("a1", "alimentaire")], stock_soldes: [solde("a1", "L1", "2026-10-30")], stock_unites: [], alerts: [] });
    const origine = db.from.bind(db);
    const erreur = { code: "22P02", message: 'invalid input value for enum alert_type: "stock_dlc_proche"' };
    db.from = ((nom: string) => {
      const q: any = origine(nom);
      if (nom !== "alerts") return q;
      return new Proxy(q, {
        get(cible, prop) {
          if (prop === "insert" || prop === "select") return () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: erreur }).then(ok), eq: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: null, error: erreur }) }) }) }) });
          return cible[prop];
        },
      });
    }) as never;
    expect(await synchroniserAlertesDlc(db as never, ORG)).toMatchObject({ typeAbsent: true, creees: 0 });
  });
});

describe("règles d'alerte des profils appliquées aux autres alertes", () => {
  it("seuil mini désactivé pour le profil de l'article : pas d'alerte de seuil", async () => {
    const db = fakeDb({
      stock_parametres: [parametres(["vrac"], { vrac: { alertes: { seuil_mini: false } } })],
      stock_articles: [article("a1", "vrac", { seuil_mini: 10 })],
      stock_soldes: [solde("a1", "", null, 2)],
      alerts: [],
    });
    expect((await synchroniserAlertesSeuil(db as never, ORG)).creees).toBe(0);
    const actif = fakeDb({ stock_parametres: [parametres(["vrac"])], stock_articles: [article("a1", "vrac", { seuil_mini: 10 })], stock_soldes: [solde("a1", "", null, 2)], alerts: [] });
    expect((await synchroniserAlertesSeuil(actif as never, ORG)).creees).toBe(1);
  });
  it("écart d'inventaire désactivé : aucune alerte", async () => {
    const db = fakeDb({ stock_parametres: [parametres(["messagerie"], { messagerie: { alertes: { ecart_inventaire: false } } })], alerts: [] });
    const r = await alerterEcartInventaire(db as never, { organizationId: ORG, inventaireId: "i1", site: "Nord", serviceId: null, phrase: "2 écarts" });
    expect(r).toEqual({ creee: false, typeAbsent: false });
    expect(db.ligne("alerts")).toHaveLength(0);
  });
  it("unités non rentrées désactivées : aucune alerte", async () => {
    const db = fakeDb({
      stock_parametres: [parametres(["messagerie"], { messagerie: { alertes: { non_rentre: false } } })],
      stock_unites: [{ organization_id: ORG, run_id: "r1", statut: "en_tournee", emplacement_id: null }],
      delivery_runs: [{ id: "r1", organization_id: ORG, name: "T1", run_date: "2026-10-27", status: "done", service_id: null }],
      alerts: [],
    });
    expect((await synchroniserAlertesNonRentre(db as never, ORG)).creees).toBe(0);
  });
});
