import { describe, expect, it } from "vitest";
import { premierReleve } from "@/lib/vehicles/odometer-reference";

describe("relevé postérieur à un plein rétroactif", () => {
  it("prend le relevé le plus ancien après la date du plein", () => {
    const r = premierReleve([
      { km: 120450, at: "2026-10-15T17:00:00Z", source: "Retour tournée n°3" },
      { km: 120300, at: "2026-10-13T09:00:00Z", source: "Plein de carburant" },
    ]);
    expect(r?.km).toBe(120300);
  });
  it("aucun relevé postérieur", () => {
    expect(premierReleve([])).toBeNull();
  });
});
