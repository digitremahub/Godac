import { describe, expect, it } from "vitest";
import { decisionLimite, empreinteIp, estimerFenetreGlissante, ipDepuisEntetes, LimiteurMemoire, REGLES_LIMITE } from "@/lib/http/limite-debit";

describe("fenêtre glissante approchée", () => {
  it("la fenêtre précédente compte au prorata de ce qui en reste", () => {
    expect(estimerFenetreGlissante(2, 10, 0, 60)).toBe(12);
    expect(estimerFenetreGlissante(2, 10, 30, 60)).toBe(7);
    expect(estimerFenetreGlissante(2, 10, 60, 60)).toBe(2);
  });
  it("refuse au-delà du maximum avec un Retry-After d'au moins 1 s", () => {
    expect(decisionLimite(5, 5, 10, 60)).toEqual({ autorise: true, retryApresS: 0 });
    expect(decisionLimite(5.1, 5, 10, 60)).toEqual({ autorise: false, retryApresS: 50 });
    expect(decisionLimite(9, 5, 60, 60).retryApresS).toBe(1);
  });
});

describe("repli en mémoire", () => {
  const regle = { nom: "test", max: 3, fenetreS: 10 };
  it("autorise max passages puis refuse jusqu'à la fin de la fenêtre", () => {
    const l = new LimiteurMemoire();
    for (let i = 0; i < 3; i++) expect(l.consommer("ip-a", regle, 1000 + i * 100).autorise).toBe(true);
    const refus = l.consommer("ip-a", regle, 1500);
    expect(refus.autorise).toBe(false);
    expect(refus.retryApresS).toBe(10);
    // Chaque IP a son propre compteur.
    expect(l.consommer("ip-b", regle, 1500).autorise).toBe(true);
    // Le plus ancien passage sort de la fenêtre : un nouveau passage est permis.
    expect(l.consommer("ip-a", regle, 11_050).autorise).toBe(true);
  });
  it("garde sa mémoire bornée", () => {
    const l = new LimiteurMemoire(3);
    for (let i = 0; i < 10; i++) l.consommer(`ip-${i}`, regle, 1000);
    expect((l as unknown as { passages: Map<string, number[]> }).passages.size).toBeLessThanOrEqual(3);
  });
});

describe("adresse IP", () => {
  it("prend la première adresse de x-forwarded-for, puis x-real-ip", () => {
    expect(ipDepuisEntetes(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(ipDepuisEntetes(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(ipDepuisEntetes(new Headers())).toBe("inconnue");
  });
  it("n'expose jamais l'IP en clair", () => {
    const e = empreinteIp("1.2.3.4");
    expect(e).toHaveLength(32);
    expect(e).not.toContain("1.2.3.4");
  });
  it("chaque route publique a une règle nommée, positive", () => {
    for (const r of Object.values(REGLES_LIMITE)) {
      expect(r.nom).toMatch(/^[a-z-]+$/);
      expect(r.max).toBeGreaterThan(0);
      expect(r.fenetreS).toBeGreaterThan(0);
    }
  });
});
