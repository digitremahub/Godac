import { describe, expect, it } from "vitest";
import { deciderAjout, etatLimite, plafondBlocage } from "@/lib/acces/limites";

describe("limite de véhicules (Q8 : avertissement à 100 %, blocage au-delà de 110 %)", () => {
  it("plafond = 110 % arrondi à l'inférieur", () => {
    expect(plafondBlocage(20)).toBe(22);
    expect(plafondBlocage(5)).toBe(5);
    expect(plafondBlocage(60)).toBe(66);
    expect(plafondBlocage(150)).toBe(165);
  });

  it("ajout sous la limite : sans avertissement", () => {
    expect(deciderAjout({ utilise: 10, inclus: 20 })).toEqual({ ok: true, avertissement: null });
  });

  it("atteindre la limite : avertissement", () => {
    const d = deciderAjout({ utilise: 19, inclus: 20, formule: "Starter" });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.avertissement).toMatch(/Starter inclut 20 véhicules/);
  });

  it("jusqu'à 110 % : accepté avec avertissement, au-delà refusé", () => {
    expect(deciderAjout({ utilise: 21, inclus: 20 }).ok).toBe(true);
    const d = deciderAjout({ utilise: 22, inclus: 20 });
    expect(d.ok).toBe(false);
    expect(deciderAjout({ utilise: 15, inclus: 20, ajout: 10 }).ok).toBe(false);
  });

  it("formule illimitée", () => {
    expect(deciderAjout({ utilise: 500, inclus: null })).toEqual({ ok: true, avertissement: null });
    expect(etatLimite(3, null).niveau).toBe("ok");
  });

  it("niveaux de la jauge", () => {
    expect(etatLimite(10, 20).niveau).toBe("ok");
    expect(etatLimite(16, 20).niveau).toBe("proche");
    expect(etatLimite(20, 20).niveau).toBe("avertissement");
    expect(etatLimite(22, 20).niveau).toBe("bloque");
  });
});
