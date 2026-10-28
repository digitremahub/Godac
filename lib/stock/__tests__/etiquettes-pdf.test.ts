import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { genererEtiquettesPdf } from "@/lib/stock/etiquettes-pdf";
import { construireEtiquette, etiquetteVierge } from "@/lib/stock/etiquettes";
import { DEFINITION_FORMATS, FORMATS_ETIQUETTE, nombrePages } from "@/lib/stock/formats-etiquette";
import { CHAMPS_ETIQUETTE } from "@/lib/stock/profils";

const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
const ctx = { entreprise: "Transports Martin et Fils", depot: "Dépôt Nord", emplacement: "Quai 3", date: "28/10/2026", logo: false };
const vierges = (n: number) => Array.from({ length: n }, (_, i) => etiquetteVierge(`TRA-2026-${String(i + 1).padStart(6, "0")}`, ctx));

describe("PDF des étiquettes (rendu réel react-pdf)", () => {
  for (const cle of FORMATS_ETIQUETTE) {
    it(`${cle} : PDF valide, bon nombre de pages pour 24 étiquettes`, async () => {
      const f = DEFINITION_FORMATS[cle];
      const buf = await genererEtiquettesPdf({ format: f, etiquettes: vierges(24) });
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pages(buf)).toBe(nombrePages(24, f));
    });
  }
  it("A4 3 × 7, 50 étiquettes : 3 pages ; 100 étiquettes : 5 pages", async () => {
    const f = DEFINITION_FORMATS.a4_3x7;
    expect(pages(await genererEtiquettesPdf({ format: f, etiquettes: vierges(50) }))).toBe(3);
    expect(pages(await genererEtiquettesPdf({ format: f, etiquettes: vierges(100) }))).toBe(5);
  });
  it("planche entamée : les emplacements déjà utilisés décalent la première page", async () => {
    const f = DEFINITION_FORMATS.a4_2x4;
    expect(pages(await genererEtiquettesPdf({ format: f, etiquettes: vierges(8), debut: 0 }))).toBe(1);
    expect(pages(await genererEtiquettesPdf({ format: f, etiquettes: vierges(8), debut: 3 }))).toBe(2);
  });
  it("page A4 en points (210 × 297 mm) et page thermique 100 × 150 mm", async () => {
    const a4 = await genererEtiquettesPdf({ format: DEFINITION_FORMATS.a4_3x7, etiquettes: vierges(1) });
    expect(a4.toString("latin1")).toMatch(/\/MediaBox \[\s*0 0 595\.27\d* 841\.88\d*\s*\]/);
    const th = await genererEtiquettesPdf({ format: DEFINITION_FORMATS.thermique_100x150, etiquettes: vierges(1) });
    expect(th.toString("latin1")).toMatch(/\/MediaBox \[\s*0 0 283\.46\d* 425\.19\d*\s*\]/);
  });
  it("étiquette complète (tous les champs, pictogrammes, consigne longue, code non encodable) : une page par étiquette, sans page en trop", async () => {
    const u = { code: "Étiquette n°1", code_interne: null, nature: "prelevement" as const, temperature: "congele" as const, fragile: true, urgent: true, consigne: "x".repeat(120), reference_client: "BL-1", lot: "L1", dlc: "2026-11-30" };
    for (const cle of ["thermique_100x150", "etiquette_62x29"] as const) {
      const e = construireEtiquette(u, ctx, CHAMPS_ETIQUETTE);
      expect(pages(await genererEtiquettesPdf({ format: DEFINITION_FORMATS[cle], etiquettes: [e, e, e] })), cle).toBe(3);
    }
  });
});
