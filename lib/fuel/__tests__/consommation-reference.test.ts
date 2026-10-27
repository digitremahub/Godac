import { describe, expect, it } from "vitest";
import { SEUIL_ECART_CONSOMMATION_REFERENCE, cleConsommationReference, ecartConsommationReference, messageConsommationReference } from "../consommation-reference";

describe("consommation au-dessus de la référence", () => {
  it("le seuil nommé est de +25 %", () => {
    expect(SEUIL_ECART_CONSOMMATION_REFERENCE).toBe(0.25);
  });
  it("anomalie au-delà du seuil, pas à +25 % exactement", () => {
    expect(ecartConsommationReference(32, 25)).toEqual({ ecartPourcent: 28, anomalie: true });
    expect(ecartConsommationReference(31.25, 25)).toEqual({ ecartPourcent: 25, anomalie: false });
    expect(ecartConsommationReference(26, 25)).toEqual({ ecartPourcent: 4, anomalie: false });
  });
  it("sous la référence : écart négatif, pas d'anomalie", () => {
    expect(ecartConsommationReference(20, 25)).toEqual({ ecartPourcent: -20, anomalie: false });
  });
  it("seuil personnalisable", () => {
    expect(ecartConsommationReference(28, 25, 0.1)?.anomalie).toBe(true);
  });
  it("mesure ou référence absente ou inutilisable : aucun jugement", () => {
    for (const [m, r] of [[null, 25], [undefined, 25], [30, null], [30, undefined], [30, ""], [30, 0], [0, 25], [Number.NaN, 25], [30, "abc"]] as const) expect(ecartConsommationReference(m as number | null, r as number | null), `${m}/${r}`).toBeNull();
  });
  it("la référence peut arriver en texte (numeric de PostgREST)", () => {
    expect(ecartConsommationReference(40, "30.0")?.anomalie).toBe(true);
  });
  it("une alerte par véhicule et par mois", () => {
    expect(cleConsommationReference("v1", "2026-10-27")).toBe("conso_ref:v1:2026-10");
    expect(cleConsommationReference("v1", "2026-10-03")).toBe(cleConsommationReference("v1", "2026-10-27"));
    expect(cleConsommationReference("v1", "2026-11-01")).not.toBe(cleConsommationReference("v1", "2026-10-27"));
  });
  it("message lisible", () => {
    const m = messageConsommationReference({ registration: "AB-123-CD", mesuree: 32, reference: 25, ecartPourcent: 28 });
    expect(m).toContain("AB-123-CD");
    expect(m).toContain("28 % au-dessus");
  });
});
