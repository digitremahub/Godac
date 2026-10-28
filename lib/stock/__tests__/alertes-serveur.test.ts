import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => null }));

import { alerterEcartInventaire, synchroniserAlertesNonRentre, synchroniserAlertesSeuil } from "@/lib/stock/alertes-serveur";
import { fakeDb } from "../../planning/__tests__/_fake-db";

const ORG = "o1";
const article = (id: string, seuil: number, actif = true) => ({ id, organization_id: ORG, code: `R-${id}`, nom: `Article ${id}`, unite: "pièce", seuil_mini: seuil, actif });
const solde = (article_id: string, quantite: number, site_id = "s1") => ({ organization_id: ORG, article_id, site_id, emplacement_id: null, lot: "", quantite });

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("alertes de seuil (écriture)", () => {
  it("crée une alerte par article sous le seuil, sans service, pour la direction et l'exploitation", async () => {
    const db = fakeDb({ stock_articles: [article("a", 10), article("b", 5), article("c", 0)], stock_soldes: [solde("a", 4), solde("a", 3, "s2"), solde("b", 9)], alerts: [] });
    const bilan = await synchroniserAlertesSeuil(db as never, ORG);
    expect(bilan).toMatchObject({ creees: 1, closes: 0, typeAbsent: false, erreur: null });
    expect(db.ligne("alerts")).toHaveLength(1);
    expect(db.ligne("alerts")[0]).toMatchObject({ type: "stock_seuil", related_table: "stock_articles", related_id: "a", service_id: null, cle_dedoublonnage: "stock:seuil:a", severity: "warning" });
    expect(db.ligne("alerts")[0]!.recipient_roles).toEqual(["direction", "exploitation", "manager"]);
    expect(db.ligne("alerts")[0]!.message).toContain("7 en stock pour un minimum de 10");
  });

  it("deuxième passage : aucun doublon ; stock remonté : alerte close ; nouveau passage sous le seuil : rouverte", async () => {
    const db = fakeDb({ stock_articles: [article("a", 10)], stock_soldes: [solde("a", 4)], alerts: [] });
    await synchroniserAlertesSeuil(db as never, ORG);
    expect((await synchroniserAlertesSeuil(db as never, ORG)).creees).toBe(0);
    expect(db.ligne("alerts")).toHaveLength(1);

    db.ligne("stock_soldes")[0]!.quantite = 12;
    expect((await synchroniserAlertesSeuil(db as never, ORG)).closes).toBe(1);
    expect(db.ligne("alerts")[0]!.status).toBe("resolved");

    db.ligne("stock_soldes")[0]!.quantite = 2;
    const bilan = await synchroniserAlertesSeuil(db as never, ORG);
    expect(bilan.creees).toBe(1);
    expect(db.ligne("alerts")).toHaveLength(1);
    expect(db.ligne("alerts")[0]!.status).toBe("open");
  });

  it("tables du stock absentes : bilan vide, sans erreur", async () => {
    const bilan = await synchroniserAlertesSeuil(fakeDb({ alerts: [] }) as never, ORG);
    expect(bilan).toEqual({ creees: 0, closes: 0, typeAbsent: false, erreur: null });
  });

  it("type d'alerte absent de l'enum (migration non appliquée) : rien n'est créé, le bilan le dit", async () => {
    const db = fakeDb({ stock_articles: [article("a", 10)], stock_soldes: [], alerts: [] });
    const origine = db.from.bind(db);
    db.from = ((nom: string) => {
      const q: any = origine(nom);
      if (nom !== "alerts") return q;
      return new Proxy(q, {
        get(cible, prop) {
          if (prop === "insert" || prop === "select") return () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code: "22P02", message: 'invalid input value for enum alert_type: "stock_seuil"' } }).then(ok), eq: () => ({ eq: () => ({ in: () => ({ limit: () => Promise.resolve({ data: null, error: { code: "22P02", message: 'invalid input value for enum alert_type: "stock_seuil"' } }) }) }) }) });
          return cible[prop];
        },
      });
    }) as never;
    const bilan = await synchroniserAlertesSeuil(db as never, ORG);
    expect(bilan.typeAbsent).toBe(true);
    expect(bilan.creees).toBe(0);
  });
});

describe("alertes d'unités non rentrées (écriture)", () => {
  const run = (id: string, status: string, service_id: string | null = "sv1") => ({ id, organization_id: ORG, name: `T${id}`, run_date: "2026-10-28", status, service_id });
  const unite = (code: string, run_id: string | null, statut: string, emplacement_id: string | null = null) => ({ organization_id: ORG, code, run_id, statut, emplacement_id });

  it("une alerte par tournée clôturée avec des unités encore en tournée, portant le service", async () => {
    const db = fakeDb({
      delivery_runs: [run("r1", "done"), run("r2", "in_progress")],
      stock_unites: [unite("C1", "r1", "en_tournee"), unite("C2", "r1", "retour"), unite("C3", "r1", "retour", "emp"), unite("C4", "r2", "en_tournee")],
      alerts: [],
    });
    const bilan = await synchroniserAlertesNonRentre(db as never, ORG);
    expect(bilan.creees).toBe(1);
    expect(db.ligne("alerts")[0]).toMatchObject({ type: "stock_non_rentre", related_table: "delivery_runs", related_id: "r1", service_id: "sv1", cle_dedoublonnage: "stock:non_rentre:r1" });
    expect(db.ligne("alerts")[0]!.message).toContain("2 unités chargées en tournée Tr1");
  });

  it("alerte close quand tout est rentré", async () => {
    const db = fakeDb({ delivery_runs: [run("r1", "done")], stock_unites: [unite("C1", "r1", "en_tournee")], alerts: [] });
    await synchroniserAlertesNonRentre(db as never, ORG);
    db.ligne("stock_unites")[0]!.statut = "dans_depot";
    db.ligne("stock_unites")[0]!.run_id = null;
    const bilan = await synchroniserAlertesNonRentre(db as never, ORG);
    expect(bilan.closes).toBe(1);
    expect(db.ligne("alerts")[0]!.status).toBe("resolved");
  });
});

describe("alerte d'écart d'inventaire", () => {
  it("une alerte par inventaire, rattachée au service du dépôt", async () => {
    const db = fakeDb({ alerts: [] });
    const r = await alerterEcartInventaire(db as never, { organizationId: ORG, inventaireId: "i1", site: "Dépôt Nord", serviceId: "sv1", phrase: "2 écarts : 1 unité non retrouvée." });
    expect(r.creee).toBe(true);
    expect(db.ligne("alerts")[0]).toMatchObject({ type: "stock_ecart", related_table: "stock_inventaires", related_id: "i1", service_id: "sv1", cle_dedoublonnage: "stock:ecart:i1" });
    const encore = await alerterEcartInventaire(db as never, { organizationId: ORG, inventaireId: "i1", site: "Dépôt Nord", serviceId: "sv1", phrase: "2 écarts" });
    expect(encore.creee).toBe(false);
    expect(db.ligne("alerts")).toHaveLength(1);
  });
});
