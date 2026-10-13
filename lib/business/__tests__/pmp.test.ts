import { describe, expect, it } from "vitest";
import { computeDeliveryPmp, isPriceAnomalous } from "../pmp";

describe("computeDeliveryPmp", () => {
  it("première livraison : prix de la livraison", () => {
    expect(computeDeliveryPmp({ stockLiters: 0, pmp: null }, { liters: 5000, unitPrice: 1.4 })).toBe(1.4);
  });

  it("pondère le stock restant et la livraison", () => {
    // 1000 L restants à 1,40 + 4000 L livrés à 1,60 → (1400 + 6400) / 5000 = 1,56
    expect(computeDeliveryPmp({ stockLiters: 1000, pmp: 1.4 }, { liters: 4000, unitPrice: 1.6 })).toBe(1.56);
  });

  it("cuve vide ou stock négatif : prix de la livraison", () => {
    expect(computeDeliveryPmp({ stockLiters: 0, pmp: 1.4 }, { liters: 3000, unitPrice: 1.65 })).toBe(1.65);
    expect(computeDeliveryPmp({ stockLiters: -200, pmp: 1.4 }, { liters: 3000, unitPrice: 1.65 })).toBe(1.65);
  });

  it("refuse des litres nuls", () => {
    expect(() => computeDeliveryPmp({ stockLiters: 0, pmp: null }, { liters: 0, unitPrice: 1.5 })).toThrow();
  });
});

describe("isPriceAnomalous", () => {
  it("flags a price more than the threshold away from PMP", () => {
    expect(isPriceAnomalous(2.0, 1.5, 0.15)).toBe(true);
  });

  it("does not flag a price within the threshold", () => {
    expect(isPriceAnomalous(1.55, 1.5, 0.15)).toBe(false);
  });

  it("never flags when there is no PMP baseline yet", () => {
    expect(isPriceAnomalous(5, 0)).toBe(false);
  });
});
