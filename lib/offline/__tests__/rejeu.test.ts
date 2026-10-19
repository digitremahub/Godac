import { describe, expect, it } from "vitest";
import { decisionApresEchec, ESSAIS_MAX, rejouablePar } from "@/lib/offline/rejeu";

describe("rejeu de la file hors ligne", () => {
  it("abandonne sur une erreur 4xx définitive", () => {
    expect(decisionApresEchec(400, 1)).toBe("abandonner");
    expect(decisionApresEchec(403, 1)).toBe("abandonner");
    expect(decisionApresEchec(409, 1)).toBe("abandonner");
    expect(decisionApresEchec(422, 1)).toBe("abandonner");
  });
  it("retente une session expirée, un 5xx ou une coupure réseau, jusqu'à la limite", () => {
    expect(decisionApresEchec(401, 1)).toBe("reessayer");
    expect(decisionApresEchec(429, 1)).toBe("reessayer");
    expect(decisionApresEchec(503, 1)).toBe("reessayer");
    expect(decisionApresEchec(null, 1)).toBe("reessayer");
    expect(decisionApresEchec(503, ESSAIS_MAX)).toBe("abandonner");
    expect(decisionApresEchec(null, ESSAIS_MAX)).toBe("abandonner");
  });
  it("ne rejoue que sous le compte qui a enregistré l'action", () => {
    expect(rejouablePar("a", "a")).toBe(true);
    expect(rejouablePar("a", "b")).toBe(false);
    expect(rejouablePar(undefined, "a")).toBe(false);
    expect(rejouablePar("a", null)).toBe(false);
  });
});
