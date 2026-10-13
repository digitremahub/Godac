import { describe, expect, it } from "vitest";
import { partSaisissableMensuelle } from "@/lib/paie/parametres";

describe("part saisissable (barème annuel ramené au mois)", () => {
  it("net de 1 500 €/mois sans personne à charge", () => {
    // 18 000 €/an : 4370/20 + 4150/10 + 4170/5 + 4130/4 + 1180/3 = 218,5 + 415 + 834 + 1032,5 + 393,33 = 2893,33 → /12
    expect(partSaisissableMensuelle(1500)).toBeCloseTo(241.11, 1);
  });
  it("les personnes à charge relèvent les seuils", () => {
    expect(partSaisissableMensuelle(1500, 2)).toBeLessThan(partSaisissableMensuelle(1500));
  });
  it("rien de saisissable sur un net nul", () => {
    expect(partSaisissableMensuelle(0)).toBe(0);
  });
});
