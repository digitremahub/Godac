import { describe, expect, it } from "vitest";
import { doublonsProbables } from "@/lib/ticpe/controles";
import { eligibiliteVehicule } from "@/lib/ticpe/eligibilite";
import { PTAC_MIN_KG } from "@/lib/ticpe/export";
import { REGLAGES_PAR_DEFAUT } from "@/lib/ticpe/reglages";
import {
  FICHES_TICPE_DEMO,
  MOIS_NON_DECLARES_DEMO,
  declarationsDemo,
  decalerMois,
  moisHistorique,
  pdfFictif,
  pleinsStationDemo,
} from "@/lib/demo/donnees-ticpe";

const CAMIONS = [
  { registration: "FH-123-AB", reservoir: 300 },
  { registration: "GK-456-CD", reservoir: 300 },
  { registration: "JL-321-GH", reservoir: 600 },
  { registration: "KM-654-IJ", reservoir: 300 },
];
const TODAY = "2026-10-22";

describe("démo TICPE — données", () => {
  it("décale les mois et couvre janvier 2025 → mois dernier", () => {
    expect(decalerMois("2025-12", 1)).toBe("2026-01");
    expect(decalerMois("2026-01", -1)).toBe("2025-12");
    const mois = moisHistorique(TODAY);
    expect(mois[0]).toBe("2025-01");
    expect(mois.at(-1)).toBe("2026-09");
    expect(mois).toHaveLength(21);
  });

  it("classe les véhicules : 5 éligibles, 1 à vérifier, 2 utilitaires exclus", () => {
    const types: Record<string, "PL" | "SPL" | "VL"> = { "JL-321-GH": "SPL", "MP-147-MN": "VL", "NQ-258-OP": "VL" };
    const statuts = Object.entries(FICHES_TICPE_DEMO).map(([immat, f]) =>
      eligibiliteVehicule({ type: types[immat] ?? "PL", ptac_kg: f.ptac_kg, fuel_type: "Gazole", cg_genre: f.cg_genre, cg_energie: f.cg_energie }, { reglages: REGLAGES_PAR_DEFAUT, aCarteGrise: f.carteGrise }).statut,
    );
    expect(statuts.filter((s) => s === "eligible")).toHaveLength(5);
    expect(statuts.filter((s) => s === "a_verifier")).toHaveLength(1);
    expect(statuts.filter((s) => s === "exclu")).toHaveLength(2);
    expect(Object.values(FICHES_TICPE_DEMO).filter((f) => f.ptac_kg !== null && f.ptac_kg >= PTAC_MIN_KG)).toHaveLength(5);
  });

  it("génère des pleins déterministes, sous la capacité du réservoir, avec deux cas à contrôler le mois dernier", () => {
    const pleins = pleinsStationDemo(TODAY, CAMIONS);
    expect(pleinsStationDemo(TODAY, CAMIONS)).toEqual(pleins);
    expect(pleins).toHaveLength(21 * CAMIONS.length * 3 + 3);
    for (const p of pleins) {
      const reservoir = CAMIONS.find((c) => c.registration === p.registration)!.reservoir;
      expect(p.liters).toBeGreaterThan(0);
      expect(p.liters).toBeLessThanOrEqual(reservoir);
    }
    const sans = pleins.filter((p) => p.ticpe_justificatif === null);
    expect(sans).toHaveLength(1);
    expect(sans[0]!.jour.startsWith("2026-09")).toBe(true);

    const enDate = pleins.map((p, i) => ({ id: String(i), vehicle_id: p.registration, occurred_at: `${p.jour}T${p.heure}:00Z`, liters: p.liters }));
    const doublons = doublonsProbables(enDate);
    expect(doublons).toHaveLength(1);
    expect(doublons[0]![0].occurred_at.startsWith("2026-09-28")).toBe(true);
  });

  it("déclare tout jusqu'à l'avant-dernier mois, sauf les mois oubliés de 2025", () => {
    const pleins = pleinsStationDemo(TODAY, CAMIONS);
    const decl = declarationsDemo(TODAY, pleins, new Set(["FH-123-AB", "GK-456-CD", "JL-321-GH"]));
    const cles = decl.map((d) => d.periode_cle);
    expect(cles).not.toContain("2026-09");
    for (const m of MOIS_NON_DECLARES_DEMO) expect(cles).not.toContain(m);
    expect(cles).toHaveLength(20 - MOIS_NON_DECLARES_DEMO.length);
    const fevrier = decl.find((d) => d.periode_cle === "2025-02")!;
    expect(fevrier.periode_fin).toBe("2025-02-28");
    expect(fevrier.declaree_le).toBe("2025-03-17");
    expect(fevrier.montant).toBeCloseTo(fevrier.litres * 0.1556, 1);
    expect(fevrier.litres).toBeGreaterThan(0);
  });

  it("produit un PDF minimal lisible", () => {
    const texte = new TextDecoder().decode(pdfFictif(["Carte grise (exemple)"]));
    expect(texte.startsWith("%PDF-1.4")).toBe(true);
    expect(texte.trimEnd().endsWith("%%EOF")).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(texte)![1]);
    expect(texte.slice(xref, xref + 4)).toBe("xref");
    expect(texte).toContain("Carte grise \\(exemple\\)");
  });
});
