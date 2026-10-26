import { describe, expect, it } from "vitest";
import { decisionApresEchec, rejouablePar } from "@/lib/offline/rejeu";

describe("rejeu de la file hors ligne", () => {
  it("abandonne sur une erreur 4xx définitive", () => {
    expect(decisionApresEchec(400)).toBe("abandonner");
    expect(decisionApresEchec(403)).toBe("abandonner");
    expect(decisionApresEchec(409)).toBe("abandonner");
    expect(decisionApresEchec(422)).toBe("abandonner");
  });
  it("ne retire jamais une action sur une coupure réseau, un 5xx, un 408, un 429 ou une session expirée", () => {
    for (const status of [401, 408, 429, 500, 503, null]) expect(decisionApresEchec(status)).toBe("reessayer");
  });
  it("ne rejoue que sous le compte qui a enregistré l'action", () => {
    expect(rejouablePar("a", "a")).toBe(true);
    expect(rejouablePar("a", "b")).toBe(false);
    expect(rejouablePar(undefined, "a")).toBe(false);
    expect(rejouablePar("a", null)).toBe(false);
  });
});
