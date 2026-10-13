import { describe, expect, it } from "vitest";
import { dernierReleve } from "@/lib/vehicles/odometer-reference";

describe("kilométrage actuel", () => {
  it("prend le relevé le plus récent, pas le plus élevé", () => {
    const r = dernierReleve([
      { km: 120000, at: "2026-10-01T08:00:00Z", source: "Départ tournée n°1" },
      { km: 120450, at: "2026-10-12T17:00:00Z", source: "Retour tournée n°3" },
      { km: 120300, at: "2026-10-10T09:00:00Z", source: "Plein de carburant" },
    ]);
    expect(r?.km).toBe(120450);
    expect(r?.source).toBe("Retour tournée n°3");
  });
  it("aucun relevé", () => {
    expect(dernierReleve([])).toBeNull();
  });
});
