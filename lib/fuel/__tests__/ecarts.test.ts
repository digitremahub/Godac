import { describe, expect, it } from "vitest";
import {
  actionAutorisee,
  commentaireValide,
  droitsEcart,
  ecartsDuPlein,
  statutEcart,
  tableAbsente,
  type PleinPourEcarts,
} from "../ecarts";

function plein(overrides: Partial<PleinPourEcarts> = {}): PleinPourEcarts {
  return {
    liters: 100,
    unit_price: 1.5,
    totalizer_before: 1000,
    totalizer_after: 1100,
    totalizer_gap: 0,
    gap_flagged: false,
    pmp_at_entry: 1.5,
    tank_id: "cuve-1",
    ocr_raw: null,
    ...overrides,
  };
}

describe("ecartsDuPlein", () => {
  it("aucun écart sur un plein cohérent", () => {
    expect(ecartsDuPlein(plein())).toEqual([]);
  });

  it("écart de totaliseur signalé par le trigger", () => {
    const e = ecartsDuPlein(plein({ gap_flagged: true, totalizer_gap: 12.5 }));
    expect(e.map((x) => x.code)).toEqual(["totaliseur"]);
    expect(e[0]!.detail).toContain("+12,5 L");
  });

  it("litres incohérents avec le totaliseur au-delà de 0,5 L, pas en deçà", () => {
    expect(ecartsDuPlein(plein({ liters: 100.4 })).map((x) => x.code)).toEqual([]);
    const e = ecartsDuPlein(plein({ liters: 90, unit_price: 1.5 }));
    expect(e.map((x) => x.code)).toEqual(["litres_totaliseur"]);
    expect(e[0]!.detail).toContain("100 L");
  });

  it("prix éloigné du PMP de plus de 15 %", () => {
    expect(ecartsDuPlein(plein({ unit_price: 1.7 })).map((x) => x.code)).toEqual([]);
    expect(ecartsDuPlein(plein({ unit_price: 1.8 })).map((x) => x.code)).toEqual(["prix_pmp"]);
  });

  it("achat en station : ni totaliseur ni PMP contrôlés", () => {
    const e = ecartsDuPlein(plein({ tank_id: null, liters: 50, unit_price: 3, pmp_at_entry: 1, totalizer_before: null, totalizer_after: null }));
    expect(e).toEqual([]);
  });

  it("montant du ticket OCR différent de litres × prix", () => {
    const ocr_raw = { fields: { total_amount: 160, fuel_type: "Gazole" } };
    expect(ecartsDuPlein(plein({ tank_id: null, ocr_raw })).map((x) => x.code)).toEqual(["ticket_ocr"]);
    // Dans la tolérance (2 % ou 0,50 €).
    expect(ecartsDuPlein(plein({ tank_id: null, ocr_raw: { fields: { total_amount: 150.3 } } }))).toEqual([]);
  });

  it("consommation anormale lue dans les alertes liées", () => {
    const e = ecartsDuPlein(plein(), [{ type: "price_anomaly" }, { type: "consumption_anomaly", message: "Consommation de AB-123-CD en hausse" }]);
    expect(e.map((x) => x.code)).toEqual(["consommation"]);
    expect(e[0]!.detail).toBe("Consommation de AB-123-CD en hausse");
  });

  it("accepte les numériques renvoyés en chaîne", () => {
    expect(ecartsDuPlein(plein({ liters: "90", totalizer_before: "1000", totalizer_after: "1100" })).map((x) => x.code)).toEqual(["litres_totaliseur"]);
  });
});

describe("statutEcart", () => {
  it("aucun écart, aucune action", () => {
    expect(statutEcart(0, [])).toBe("aucun");
  });
  it("écart sans action : ouvert", () => {
    expect(statutEcart(2, [])).toBe("ouvert");
  });
  it("la dernière action décide, quel que soit l'ordre reçu", () => {
    const t = [
      { action: "reponse_chauffeur", created_at: "2026-10-21T10:00:00Z" },
      { action: "explication_demandee", created_at: "2026-10-20T10:00:00Z" },
    ];
    expect(statutEcart(1, t)).toBe("reponse_recue");
    expect(statutEcart(1, [...t, { action: "traite", created_at: "2026-10-22T08:00:00Z" }])).toBe("traite");
    expect(statutEcart(1, [t[1]!])).toBe("explication_demandee");
  });
  it("un écart traité le reste même si le plein a été corrigé depuis", () => {
    expect(statutEcart(0, [{ action: "traite", created_at: "2026-10-22T08:00:00Z" }])).toBe("traite");
  });
});

describe("droitsEcart", () => {
  const base = { userId: "moi", driverId: "chauffeur-1", statut: "ouvert" as const };

  it("exploitation : traite comme un manager, jamais son propre plein", () => {
    expect(droitsEcart({ ...base, role: "exploitation" }).traiter).toBe(true);
    expect(droitsEcart({ ...base, role: "exploitation", driverId: "moi" }).traiter).toBe(false);
  });

  it("direction et manager traitent, pas le chauffeur ni le comptable", () => {
    expect(droitsEcart({ ...base, role: "direction" }).traiter).toBe(true);
    expect(droitsEcart({ ...base, role: "manager" }).traiter).toBe(true);
    expect(droitsEcart({ ...base, role: "chauffeur" }).traiter).toBe(false);
    expect(droitsEcart({ ...base, role: "comptable" }).traiter).toBe(false);
  });

  it("un manager qui conduit ne traite pas l'écart de son propre plein ; la direction seule, si", () => {
    expect(droitsEcart({ ...base, role: "manager", driverId: "moi" }).traiter).toBe(false);
    expect(droitsEcart({ ...base, role: "direction", driverId: "moi", directionCount: 1 }).traiter).toBe(true);
    expect(droitsEcart({ ...base, role: "direction", driverId: "moi", directionCount: 2 }).traiter).toBe(false);
  });

  it("hiérarchie : l'écart du plein d'un manager revient à l'exploitation ou à la direction, pas à un autre manager", () => {
    const duManager = { ...base, driverId: "manager-2", roleChauffeur: "manager" };
    expect(droitsEcart({ ...duManager, role: "manager" }).traiter).toBe(false);
    expect(droitsEcart({ ...duManager, role: "exploitation" }).traiter).toBe(true);
    expect(droitsEcart({ ...duManager, role: "direction" }).traiter).toBe(true);
  });

  it("hiérarchie : l'écart du plein d'une exploitation revient à la direction", () => {
    const duExploitation = { ...base, driverId: "expl-2", roleChauffeur: "exploitation" };
    expect(droitsEcart({ ...duExploitation, role: "exploitation" }).traiter).toBe(false);
    expect(droitsEcart({ ...duExploitation, role: "direction" }).traiter).toBe(true);
  });

  it("rien à traiter sans écart, ni après traitement", () => {
    expect(droitsEcart({ ...base, role: "direction", statut: "aucun" }).traiter).toBe(false);
    expect(droitsEcart({ ...base, role: "direction", statut: "traite" }).traiter).toBe(false);
    expect(droitsEcart({ ...base, role: "direction", statut: "reponse_recue" }).traiter).toBe(true);
  });

  it("le chauffeur du plein répond seulement à une explication demandée", () => {
    const chauffeur = { role: "chauffeur", userId: "chauffeur-1", driverId: "chauffeur-1" };
    expect(droitsEcart({ ...chauffeur, statut: "explication_demandee" }).repondre).toBe(true);
    expect(droitsEcart({ ...chauffeur, statut: "ouvert" }).repondre).toBe(false);
    expect(droitsEcart({ ...chauffeur, userId: "autre", statut: "explication_demandee" }).repondre).toBe(false);
  });

  it("actionAutorisee suit les droits", () => {
    const d = { traiter: false, repondre: true };
    expect(actionAutorisee("reponse_chauffeur", d)).toBe(true);
    expect(actionAutorisee("traite", d)).toBe(false);
    expect(actionAutorisee("explication_demandee", { traiter: true, repondre: false })).toBe(true);
  });
});

describe("commentaireValide / tableAbsente", () => {
  it("commentaire obligatoire", () => {
    expect(commentaireValide("")).toBe(false);
    expect(commentaireValide("  ok ")).toBe(false);
    expect(commentaireValide("Jauge recalée")).toBe(true);
    expect(commentaireValide("x".repeat(2001))).toBe(false);
  });
  it("reconnaît une table absente", () => {
    expect(tableAbsente({ code: "42P01" })).toBe(true);
    expect(tableAbsente({ code: "PGRST205", message: "Could not find the table 'public.fuel_gap_reviews'" })).toBe(true);
    expect(tableAbsente({ code: "42501", message: "permission denied" })).toBe(false);
    expect(tableAbsente(null)).toBe(false);
  });
});
