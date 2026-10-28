import { describe, expect, it } from "vitest";
import { DEFINITION_FORMATS, ETIQUETTES_MAX, FORMATS_ETIQUETTE, MM_EN_POINTS, estFormatEtiquette, mmEnPt, nombrePages, paginer, parPage, positionsEtiquettes, tientDansLaPage } from "@/lib/stock/formats-etiquette";

describe("formats d'étiquettes", () => {
  it("quatre formats : deux planches A4, une thermique 100 × 150, une petite 62 × 29", () => {
    expect([...FORMATS_ETIQUETTE]).toEqual(["a4_2x4", "a4_3x7", "thermique_100x150", "etiquette_62x29"]);
  });
  it("A4 2 × 4 : 8 étiquettes de 99,1 × 67,7 mm", () => {
    const f = DEFINITION_FORMATS.a4_2x4;
    expect(f.page).toEqual({ largeur: 210, hauteur: 297 });
    expect(f.etiquette).toEqual({ largeur: 99.1, hauteur: 67.7 });
    expect([f.colonnes, f.lignes, parPage(f)]).toEqual([2, 4, 8]);
    expect(f.planche).toBe(true);
  });
  it("A4 3 × 7 : 21 étiquettes de 63,5 × 38,1 mm", () => {
    const f = DEFINITION_FORMATS.a4_3x7;
    expect(f.page).toEqual({ largeur: 210, hauteur: 297 });
    expect(f.etiquette).toEqual({ largeur: 63.5, hauteur: 38.1 });
    expect([f.colonnes, f.lignes, parPage(f)]).toEqual([3, 7, 21]);
  });
  it("thermique 100 × 150 mm et 62 × 29 mm : une étiquette par page, pleine page", () => {
    for (const [cle, l, h] of [["thermique_100x150", 100, 150], ["etiquette_62x29", 62, 29]] as const) {
      const f = DEFINITION_FORMATS[cle];
      expect(f.page).toEqual({ largeur: l, hauteur: h });
      expect(f.etiquette).toEqual({ largeur: l, hauteur: h });
      expect(parPage(f)).toBe(1);
      expect(f.planche).toBe(false);
      expect(positionsEtiquettes(f)).toEqual([{ x: 0, y: 0 }]);
    }
  });
  it("chaque format tient dans sa page et ses positions ne se chevauchent pas", () => {
    for (const cle of FORMATS_ETIQUETTE) {
      const f = DEFINITION_FORMATS[cle];
      expect(tientDansLaPage(f), cle).toBe(true);
      const pos = positionsEtiquettes(f);
      expect(pos).toHaveLength(parPage(f));
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const a = pos[i]!;
          const b = pos[j]!;
          const recouvre = a.x < b.x + f.etiquette.largeur - 1e-9 && b.x < a.x + f.etiquette.largeur - 1e-9 && a.y < b.y + f.etiquette.hauteur - 1e-9 && b.y < a.y + f.etiquette.hauteur - 1e-9;
          expect(recouvre, `${cle} ${i}/${j}`).toBe(false);
        }
      }
    }
  });
  it("positions ligne par ligne, colonne après colonne", () => {
    const pos = positionsEtiquettes(DEFINITION_FORMATS.a4_2x4);
    expect(pos[0]).toEqual({ x: 4.65, y: 13.1 });
    expect(pos[1]!.x).toBeCloseTo(4.65 + 99.1 + 2.5, 6);
    expect(pos[1]!.y).toBeCloseTo(13.1, 6);
    expect(pos[2]!.x).toBeCloseTo(4.65, 6);
    expect(pos[2]!.y).toBeCloseTo(13.1 + 67.7, 6);
  });
  it("conversion millimètres → points PDF (1 pt = 1/72 pouce)", () => {
    expect(MM_EN_POINTS).toBeCloseTo(2.8346, 4);
    expect(mmEnPt(25.4)).toBeCloseTo(72, 6);
    expect(mmEnPt(210)).toBeCloseTo(595.28, 1);
    expect(mmEnPt(297)).toBeCloseTo(841.89, 1);
  });
  it("pagination : nombre d'étiquettes par page et de pages", () => {
    const f = DEFINITION_FORMATS.a4_3x7;
    expect(nombrePages(0, f)).toBe(0);
    expect(nombrePages(21, f)).toBe(1);
    expect(nombrePages(22, f)).toBe(2);
    expect(nombrePages(50, f)).toBe(3);
    expect(nombrePages(100, f)).toBe(5);
    expect(nombrePages(24, DEFINITION_FORMATS.a4_2x4)).toBe(3);
    expect(nombrePages(50, DEFINITION_FORMATS.thermique_100x150)).toBe(50);
    expect(nombrePages(100, DEFINITION_FORMATS.etiquette_62x29)).toBe(100);
  });
  it("paginer : pages complètes puis reste, rien de perdu ni de dupliqué", () => {
    const f = DEFINITION_FORMATS.a4_2x4;
    const codes = Array.from({ length: 20 }, (_, i) => `C${i}`);
    const pages = paginer(codes, f);
    expect(pages.map((p) => p.length)).toEqual([8, 8, 4]);
    expect(pages.flat()).toEqual(codes);
  });
  it("planche entamée : les premiers emplacements restent vides", () => {
    const f = DEFINITION_FORMATS.a4_2x4;
    const pages = paginer(["A", "B", "C"], f, 6);
    expect(pages).toEqual([[null, null, null, null, null, null, "A", "B"], ["C"]]);
    expect(nombrePages(3, f, 6)).toBe(2);
    // Emplacement de départ borné à la planche.
    expect(paginer(["A"], f, 99)[0]!.indexOf("A")).toBe(7);
  });
  it("500 étiquettes au plus par document", () => {
    expect(ETIQUETTES_MAX).toBe(500);
  });
  it("estFormatEtiquette", () => {
    expect(estFormatEtiquette("a4_3x7")).toBe(true);
    expect(estFormatEtiquette("a5")).toBe(false);
    expect(estFormatEtiquette(null)).toBe(false);
  });
});
