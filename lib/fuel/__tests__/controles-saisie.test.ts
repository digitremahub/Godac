import { describe, expect, it } from "vitest";
import {
  MARGE_RESERVOIR,
  MOTIF_MAX,
  construireConfirmation,
  controleCapacite,
  controlesKilometrage,
  lireControleConfirme,
  messageControles,
  motifControleValide,
} from "../controles-saisie";
import { ecartsDuPlein, estATraiter, pleinsATraiter, statutEcart } from "../ecarts";

const avant = { km: 100_000, at: "2026-10-20T08:00:00Z", source: "Retour tournée n°12" };
const occurredAt = "2026-10-21T08:00:00Z";

describe("capacité du réservoir", () => {
  it("accepte jusqu'à la capacité + 10 %", () => {
    expect(controleCapacite({ liters: 330, product: "gazole", capaciteLitres: 300 })).toBeNull();
    expect(controleCapacite({ liters: 300 * MARGE_RESERVOIR, product: "gazole", capaciteLitres: 300 })).toBeNull();
  });
  it("signale au-delà, avec le produit", () => {
    expect(controleCapacite({ liters: 331, product: "gazole", capaciteLitres: 300 })).toMatchObject({ code: "capacite_reservoir" });
    expect(controleCapacite({ liters: 40, product: "adblue", capaciteLitres: 30 })?.message).toContain("AdBlue");
  });
  it("capacité inconnue : aucun contrôle", () => {
    expect(controleCapacite({ liters: 5000, product: "gazole", capaciteLitres: null })).toBeNull();
    expect(controleCapacite({ liters: 5000, product: "gazole", capaciteLitres: 0 })).toBeNull();
  });
});

describe("kilométrage", () => {
  it("cohérent : aucun contrôle", () => {
    expect(controlesKilometrage({ km: 100_400, occurredAt, avant, apres: null })).toEqual([]);
  });
  it("sans relevé connu : rien à comparer", () => {
    expect(controlesKilometrage({ km: 5, occurredAt, avant: null, apres: null })).toEqual([]);
  });
  it("recul", () => {
    const c = controlesKilometrage({ km: 99_000, occurredAt, avant, apres: null });
    expect(c.map((x) => x.code)).toEqual(["km_recul"]);
    expect(c[0]!.message).toContain("Retour tournée n°12");
  });
  it("au-dessus d'un relevé postérieur (saisie rétroactive)", () => {
    const c = controlesKilometrage({ km: 100_900, occurredAt, avant, apres: { km: 100_500, at: "2026-10-25T08:00:00Z", source: "Départ tournée n°13" } });
    expect(c.map((x) => x.code)).toEqual(["km_apres_releve"]);
  });
  it("saut absurde (faute de frappe)", () => {
    expect(controlesKilometrage({ km: 1_254_300, occurredAt, avant, apres: null }).map((x) => x.code)).toEqual(["km_saut"]);
  });
});

describe("confirmation avec motif", () => {
  it("motif : 3 caractères utiles au moins, 300 au plus", () => {
    expect(motifControleValide("")).toBe(false);
    expect(motifControleValide("  ab ")).toBe(false);
    expect(motifControleValide("abc")).toBe(true);
    expect(motifControleValide("x".repeat(MOTIF_MAX + 1))).toBe(false);
    expect(motifControleValide(null)).toBe(false);
  });
  it("message unique pour les écrans qui n'affichent que `error`", () => {
    const m = messageControles([{ code: "km_recul", message: "Le kilométrage est inférieur." }]);
    expect(m).toContain("Le kilométrage est inférieur.");
    expect(m).toContain("motif");
  });
  it("la confirmation garde les contrôles, le motif nettoyé, l'auteur et la date", () => {
    const c = construireConfirmation([{ code: "km_recul", message: "recul" }], "  compteur changé ", "u1", new Date("2026-10-21T10:00:00Z"));
    expect(c).toEqual({ controles: [{ code: "km_recul", message: "recul" }], motif: "compteur changé", par: "u1", le: "2026-10-21T10:00:00.000Z" });
    expect(lireControleConfirme(c)).toEqual(c);
  });
  it("lecture tolérante de la colonne", () => {
    expect(lireControleConfirme(null)).toBeNull();
    expect(lireControleConfirme({ motif: "x" })).toBeNull();
    expect(lireControleConfirme({ controles: [], motif: "x" })).toBeNull();
    expect(lireControleConfirme("texte")).toBeNull();
  });
});

describe("l'écart confirmé remonte dans « À traiter »", () => {
  const confirme = construireConfirmation([{ code: "capacite_reservoir", message: "400 L dépasse la capacité du réservoir du véhicule (300 L)." }], "réservoir additionnel", "chauffeur-1");
  const plein = { id: "p1", liters: 400, unit_price: 1.5, controle_confirme: confirme };

  it("devient un écart « contrôle confirmé » avec le motif", () => {
    const ecarts = ecartsDuPlein(plein);
    expect(ecarts.map((e) => e.code)).toEqual(["controle_confirme"]);
    expect(ecarts[0]!.detail).toContain("réservoir additionnel");
  });
  it("est à traiter tant que l'encadrement ne l'a pas classé", () => {
    expect(estATraiter(statutEcart(1, []))).toBe(true);
    expect(pleinsATraiter([plein], new Map(), new Map())).toEqual(["p1"]);
    expect(pleinsATraiter([plein], new Map(), new Map([["p1", [{ action: "traite", created_at: "2026-10-22T08:00:00Z" }]]]))).toEqual([]);
  });
  it("un plein sans confirmation n'a aucun écart de ce type", () => {
    expect(ecartsDuPlein({ liters: 100, unit_price: 1.5 })).toEqual([]);
  });
});
