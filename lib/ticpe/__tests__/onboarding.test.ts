import { describe, expect, it } from "vitest";
import { compteurOnboarding, etapesOnboarding, signatureOnboarding, type EntreeOnboarding } from "../onboarding";

const complet: EntreeOnboarding = {
  reglagesEnregistres: true,
  tauxAConfirmer: 0,
  vehicules: [{ id: "v1", registration: "AB-123-CD", compte: true, capaciteReservoir: 400, raisons: [] }],
  points: [],
};
const etape = (e: EntreeOnboarding, id: string) => etapesOnboarding(e).find((x) => x.id === id)!;

describe("onboarding des réglages TICPE", () => {
  it("tout est en ordre : aucune étape à compléter", () => {
    expect(compteurOnboarding(etapesOnboarding(complet))).toEqual({ restantes: 0, total: 8 });
    expect(signatureOnboarding(etapesOnboarding(complet))).toBe("");
  });
  it("réglages jamais enregistrés et barème à confirmer", () => {
    expect(etape({ ...complet, reglagesEnregistres: false }, "reglages").restant).toBe(1);
    const e = etape({ ...complet, tauxAConfirmer: 6 }, "bareme");
    expect(e.restant).toBe(1);
    expect(e.detail).toContain("6 taux");
    expect(e.lien).toBe("/carburant/ticpe/reglages");
  });
  it("capacité du réservoir manquante : seulement sur les véhicules comptés, lien direct vers la fiche si un seul", () => {
    const e = {
      ...complet,
      vehicules: [
        { id: "v1", registration: "A", compte: true, capaciteReservoir: null, raisons: [] },
        { id: "v2", registration: "B", compte: true, capaciteReservoir: "0", raisons: [] },
        { id: "v3", registration: "C", compte: false, capaciteReservoir: null, raisons: [] },
        { id: "v4", registration: "D", compte: true, capaciteReservoir: "350.00", raisons: [] },
      ],
    } satisfies EntreeOnboarding;
    const c = etape(e, "capacite");
    expect(c.restant).toBe(2);
    expect(c.lien).toBe("/carburant/ticpe/vehicules");
    expect(etape({ ...e, vehicules: [e.vehicules[0]!] }, "capacite").lien).toBe("/flotte/vehicules/v1");
  });
  it("catégorie / poids et produit selon les raisons d'éligibilité", () => {
    const e = {
      ...complet,
      vehicules: [
        { id: "v1", registration: "A", compte: true, capaciteReservoir: 400, raisons: ["ptac_inconnu"] },
        { id: "v2", registration: "B", compte: true, capaciteReservoir: 400, raisons: ["ia_non_confirmee"] },
        { id: "v3", registration: "C", compte: true, capaciteReservoir: 400, raisons: ["energie_inconnue"] },
      ],
    } satisfies EntreeOnboarding;
    expect(etape(e, "poids").restant).toBe(2);
    expect(etape(e, "produit").restant).toBe(1);
  });
  it("zone, pays et justificatifs : comptés depuis les points « à régler »", () => {
    const e = { ...complet, points: [{ code: "zone_a_verifier" as const }, { code: "zone_a_verifier" as const }, { code: "hors_france" as const }, { code: "sans_justificatif" as const }, { code: "doublon" as const }] };
    expect(etape(e, "zone").restant).toBe(2);
    expect(etape(e, "pays").restant).toBe(1);
    expect(etape(e, "justificatifs").restant).toBe(1);
    expect(etape(e, "justificatifs").lien).toBe("/carburant/ticpe/controles");
    expect(compteurOnboarding(etapesOnboarding(e)).restantes).toBe(3);
  });
  it("la signature change quand une nouvelle étape est à compléter (le bandeau refermé revient)", () => {
    const avant = signatureOnboarding(etapesOnboarding({ ...complet, points: [{ code: "sans_justificatif" }] }));
    const apres = signatureOnboarding(etapesOnboarding({ ...complet, points: [{ code: "sans_justificatif" }, { code: "zone_a_verifier" }] }));
    expect(avant).toBe("justificatifs");
    expect(apres).toBe("zone,justificatifs");
  });
});
