import { describe, expect, it } from "vitest";
import { TYPES_ALERTE_STOCK, cleAlerteEcart, cleAlerteNonRentre, cleAlerteSeuil, decisionsNonRentre, decisionsSeuil, grouperNonRentrees, messageEcart, messageNonRentre, messageSeuil } from "@/lib/stock/alertes";
import { alerteAffichable, alerteVisiblePour, choisirDestinataires, peutChangerStatutAlerte } from "@/lib/alerts/destinataires";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";

const x = (id: string, quantite: number, seuil = 10) => ({ article: { id, code: `R-${id}`, nom: `Article ${id}`, unite: "pièce", seuil_mini: seuil, actif: true }, quantite, manque: seuil - quantite });

describe("alerte de seuil", () => {
  it("signale les articles sous le seuil qui n'ont pas déjà une alerte ouverte", () => {
    const d = decisionsSeuil([x("a", 3), x("b", 1)], [{ id: "al1", type: "stock_seuil", related_id: "a" }]);
    expect(d.aSignaler.map((s) => s.article.id)).toEqual(["b"]);
    expect(d.aClore).toEqual([]);
  });
  it("clôt l'alerte d'un article revenu au-dessus du seuil", () => {
    const d = decisionsSeuil([x("b", 1)], [
      { id: "al1", type: "stock_seuil", related_id: "a" },
      { id: "al2", type: "stock_seuil", related_id: "b" },
    ]);
    expect(d.aClore).toEqual(["al1"]);
    expect(d.aSignaler).toEqual([]);
  });
  it("ne touche jamais aux alertes d'un autre type ni sans lien", () => {
    const d = decisionsSeuil([], [
      { id: "al1", type: "tournee_retard", related_id: "r" },
      { id: "al2", type: "stock_seuil", related_id: null },
    ]);
    expect(d.aClore).toEqual([]);
  });
  it("message en français avec la quantité et le minimum", () => {
    expect(messageSeuil(x("a", 3))).toBe("Stock sous le seuil : Article a (R-a), 3 en stock pour un minimum de 10 pièce.");
  });
  it("clés de dédoublonnage stables", () => {
    expect(cleAlerteSeuil("a")).toBe("stock:seuil:a");
    expect(cleAlerteEcart("i")).toBe("stock:ecart:i");
    expect(cleAlerteNonRentre("r")).toBe("stock:non_rentre:r");
  });
});

describe("unités non rentrées après la clôture", () => {
  const tournees = new Map([
    ["r1", { libelle: "T106 du 28/10/2026", service_id: "s1", cloturee: true }],
    ["r2", { libelle: "T107 du 28/10/2026", service_id: "s2", cloturee: false }],
  ]);
  it("ne compte que les tournées clôturées", () => {
    const g = grouperNonRentrees([{ run_id: "r1" }, { run_id: "r1" }, { run_id: "r2" }, { run_id: null }, { run_id: "inconnue" }], tournees);
    expect(g).toEqual([{ run_id: "r1", nombre: 2, libelle: "T106 du 28/10/2026", service_id: "s1" }]);
  });
  it("signale une fois, clôt quand tout est rentré", () => {
    const g = grouperNonRentrees([{ run_id: "r1" }], tournees);
    expect(decisionsNonRentre(g, []).aSignaler).toHaveLength(1);
    expect(decisionsNonRentre(g, [{ id: "al", type: "stock_non_rentre", related_id: "r1" }]).aSignaler).toHaveLength(0);
    expect(decisionsNonRentre([], [{ id: "al", type: "stock_non_rentre", related_id: "r1" }]).aClore).toEqual(["al"]);
  });
  it("messages accordés", () => {
    expect(messageNonRentre(1, "T106")).toBe("1 unité chargée en tournée T106 n'est pas rentrée au dépôt après la clôture.");
    expect(messageNonRentre(3, "T106")).toBe("3 unités chargées en tournée T106 ne sont pas rentrées au dépôt après la clôture.");
    expect(messageEcart("Dépôt Nord", "2 écarts : …")).toContain("Dépôt Nord");
  });
});

describe("qui lit les alertes du stock", () => {
  it("jamais le chauffeur ni le comptable ; manager : son service seulement", () => {
    for (const type of TYPES_ALERTE_STOCK) {
      expect(alerteVisiblePour("chauffeur", type, "s1", ["s1"])).toBe(false);
      expect(alerteVisiblePour("comptable", type, "s1", ["s1"])).toBe(false);
      expect(alerteVisiblePour("direction", type, null)).toBe(true);
      expect(alerteVisiblePour("exploitation", type, null)).toBe(true);
      expect(alerteVisiblePour("manager", type, "s1", ["s1"])).toBe(true);
      expect(alerteVisiblePour("manager", type, "s2", ["s1"])).toBe(false);
      expect(alerteVisiblePour("manager", type, null, ["s1"])).toBe(false);
      expect(alerteAffichable("comptable", { type, service_id: null })).toBe(false);
    }
  });
  it("destinataires e-mail et push", () => {
    const candidats = [
      { id: "d", role: "direction" },
      { id: "e", role: "exploitation" },
      { id: "m1", role: "manager" },
      { id: "m2", role: "manager" },
      { id: "c", role: "comptable" },
      { id: "ch", role: "chauffeur" },
    ];
    const services = new Map([
      ["m1", ["s1"]],
      ["m2", ["s2"]],
    ]);
    expect(choisirDestinataires(candidats, { type: "stock_non_rentre", service_id: "s1" }, services).map((c) => c.id)).toEqual(["d", "e", "m1"]);
    expect(choisirDestinataires(candidats, { type: "stock_seuil", service_id: null }, services).map((c) => c.id)).toEqual(["d", "e"]);
  });
  it("seuls manager, exploitation, direction traitent l'alerte", () => {
    const alerte = { type: "stock_ecart", service_id: "s1" };
    expect(peutChangerStatutAlerte({ role: "manager", userId: "u", statut: "resolved", alerte, mesServices: ["s1"] }).ok).toBe(true);
    expect(peutChangerStatutAlerte({ role: "manager", userId: "u", statut: "resolved", alerte, mesServices: ["s2"] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "comptable", userId: "u", statut: "resolved", alerte, mesServices: [] }).ok).toBe(false);
    expect(peutChangerStatutAlerte({ role: "chauffeur", userId: "u", statut: "acknowledged", alerte, mesServices: ["s1"] }).ok).toBe(false);
  });
});

describe("liens des alertes", () => {
  it("chaque type pointe vers un écran du module", () => {
    expect(resolveAlertUrl("stock_articles", "stock_seuil", "art-1")).toBe("/exploitation/stock");
    expect(resolveAlertUrl("stock_inventaires", "stock_ecart", "inv-1")).toBe("/exploitation/stock/inventaire?inventaire=inv-1");
    expect(resolveAlertUrl("delivery_runs", "stock_non_rentre", "run-1")).toBe("/exploitation/stock?tournee=run-1#non-rentrees");
  });
  it("un destinataire qui ne peut pas ouvrir l'écran est renvoyé vers ses notifications", () => {
    const modules = new Set(["stock"]);
    expect(resolveAlertUrl("stock_articles", "stock_seuil", "art-1", { role: "comptable", modules })).toBe("/communication/alertes");
    expect(resolveAlertUrl("stock_articles", "stock_seuil", "art-1", { role: "direction", modules })).toBe("/exploitation/stock");
    expect(resolveAlertUrl("stock_articles", "stock_seuil", "art-1", { role: "direction", modules: new Set() })).toBe("/communication/alertes");
  });
});
