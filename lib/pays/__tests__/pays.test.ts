import { describe, expect, it } from "vitest";
import { PAYS, moduleDisponible, paysDe } from "@/lib/pays/pays";

describe("pays de l'entreprise", () => {
  it("France par défaut", () => {
    expect(paysDe(null).code).toBe("FR");
    expect(paysDe("XX").code).toBe("FR");
  });
  it("chaque pays a une loi, une autorité et un site https", () => {
    for (const p of PAYS) {
      expect(p.donnees.loi.length).toBeGreaterThan(3);
      expect(p.donnees.site.startsWith("https://")).toBe(true);
      // Hors UE : une formalité de transfert est toujours indiquée.
      if (!p.ue) expect(p.donnees.transfert).toBeTruthy();
    }
    expect(new Set(PAYS.map((p) => p.code)).size).toBe(PAYS.length);
  });
  it("le moteur de paie ne couvre que la France", () => {
    expect(PAYS.filter((p) => p.paie.moteur).map((p) => p.code)).toEqual(["FR"]);
  });
  it("TICPE réservée à la France, le reste partout", () => {
    expect(moduleDisponible("FR", "ticpe_export")).toBe(true);
    expect(moduleDisponible("BE", "ticpe_export")).toBe(false);
    expect(moduleDisponible("BE", "route_optimizer")).toBe(true);
  });
});
