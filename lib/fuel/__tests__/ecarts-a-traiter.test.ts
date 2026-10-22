import { describe, expect, it } from "vitest";
import { estATraiter, pleinsATraiter } from "@/lib/fuel/ecarts";

const plein = (id: string, extra: Record<string, unknown> = {}) => ({ id, liters: 50, unit_price: 1.5, ...extra });

describe("écarts carburant « à traiter » (compteur global)", () => {
  it("à traiter : écart jamais traité, ou réponse du chauffeur reçue", () => {
    expect(estATraiter("ouvert")).toBe(true);
    expect(estATraiter("reponse_recue")).toBe(true);
    expect(estATraiter("explication_demandee")).toBe(false);
    expect(estATraiter("traite")).toBe(false);
    expect(estATraiter("aucun")).toBe(false);
  });

  it("compte tous les pleins fournis, pas une page : écart de totaliseur, consommation, réponse reçue", () => {
    const pleins = [
      plein("p1", { gap_flagged: true, totalizer_gap: 3 }), // ouvert
      plein("p2"), // aucun écart
      plein("p3", { gap_flagged: true }), // traité
      plein("p4"), // consommation anormale (alerte liée)
      plein("p5", { gap_flagged: true }), // explication demandée : attend le chauffeur
      plein("p6", { gap_flagged: true }), // réponse reçue
    ];
    const alertes = new Map([["p4", [{ type: "consumption_anomaly", message: "Hausse de 20 %" }]]]);
    const traitements = new Map([
      ["p3", [{ action: "traite", created_at: "2026-10-20T10:00:00Z" }]],
      ["p5", [{ action: "explication_demandee", created_at: "2026-10-20T10:00:00Z" }]],
      [
        "p6",
        [
          { action: "explication_demandee", created_at: "2026-10-20T10:00:00Z" },
          { action: "reponse_chauffeur", created_at: "2026-10-21T10:00:00Z" },
        ],
      ],
    ]);
    expect(pleinsATraiter(pleins, alertes, traitements)).toEqual(["p1", "p4", "p6"]);
  });

  it("au-delà de 50 pleins (taille d'une page), le compteur reste juste", () => {
    const pleins = Array.from({ length: 120 }, (_, i) => plein(`p${i}`, { gap_flagged: i % 2 === 0 }));
    expect(pleinsATraiter(pleins, new Map(), new Map())).toHaveLength(60);
  });
});
