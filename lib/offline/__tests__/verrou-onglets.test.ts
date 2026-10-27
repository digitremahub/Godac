import { describe, expect, it } from "vitest";
import { EXPIRATION_VERROU_MS, libererVerrouStockage, prendreVerrouStockage, type StockageVerrou } from "@/lib/offline/verrou-onglets";

function stockage(): StockageVerrou & { donnees: Map<string, string> } {
  const donnees = new Map<string, string>();
  return { donnees, getItem: (k) => donnees.get(k) ?? null, setItem: (k, v) => void donnees.set(k, v), removeItem: (k) => void donnees.delete(k) };
}

describe("verrou de rejeu entre onglets (repli localStorage)", () => {
  it("un seul onglet à la fois", () => {
    const s = stockage();
    expect(prendreVerrouStockage(s, "A", 1000)).toBe(true);
    expect(prendreVerrouStockage(s, "B", 2000)).toBe(false);
    libererVerrouStockage(s, "A");
    expect(prendreVerrouStockage(s, "B", 3000)).toBe(true);
  });
  it("un verrou expiré (onglet fermé en plein rejeu) est repris", () => {
    const s = stockage();
    expect(prendreVerrouStockage(s, "A", 1000)).toBe(true);
    expect(prendreVerrouStockage(s, "B", 1000 + EXPIRATION_VERROU_MS - 1)).toBe(false);
    expect(prendreVerrouStockage(s, "B", 1000 + EXPIRATION_VERROU_MS)).toBe(true);
  });
  it("un onglet ne libère pas le verrou d'un autre", () => {
    const s = stockage();
    prendreVerrouStockage(s, "A", 1000);
    libererVerrouStockage(s, "B");
    expect(prendreVerrouStockage(s, "B", 1500)).toBe(false);
  });
  it("deux onglets simultanés : le dernier écrivain gagne, l'autre le constate à la relecture", () => {
    const s = stockage();
    // A lit « libre », puis B écrit, puis A écrit : A relit et voit son id ; B (déjà parti) n'a pas la main.
    const lectureA = s.getItem.bind(s);
    let premiere = true;
    s.getItem = (k) => {
      if (premiere) { premiere = false; return null; }
      return lectureA(k);
    };
    s.setItem("godac.rejeu.verrou", JSON.stringify({ id: "B", expire: 99_999 }));
    expect(prendreVerrouStockage(s, "A", 1000)).toBe(true);
    expect(prendreVerrouStockage(s, "B", 1001)).toBe(false);
  });
  it("stockage illisible : on rejoue (le serveur est idempotent)", () => {
    const casse: StockageVerrou = { getItem: () => { throw new Error("bloqué"); }, setItem: () => undefined, removeItem: () => undefined };
    expect(prendreVerrouStockage(casse, "A", 1000)).toBe(true);
  });
});
