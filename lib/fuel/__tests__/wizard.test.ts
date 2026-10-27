import { describe, expect, it } from "vitest";
import { ecransDuParcours, interactionsMinimales, libelleDernierReleve, phaseApresChauffeur, phaseInitiale } from "../wizard";

describe("premier écran de l'assistant", () => {
  it("chauffeur et véhicule connus : directement le kilométrage", () => {
    expect(phaseInitiale({ chauffeur: true, vehicule: true })).toBe("odometer");
  });
  it("seul l'élément inconnu est demandé", () => {
    expect(phaseInitiale({ chauffeur: true, vehicule: false })).toBe("vehicle");
    expect(phaseInitiale({ chauffeur: false, vehicule: true })).toBe("driver");
    expect(phaseInitiale({ chauffeur: false, vehicule: false })).toBe("driver");
  });
  it("après le chauffeur : le véhicule s'il manque, sinon le kilométrage", () => {
    expect(phaseApresChauffeur({ vehicule: false })).toBe("vehicle");
    expect(phaseApresChauffeur({ vehicule: true })).toBe("odometer");
  });
});

describe("longueur du parcours (ticket lu automatiquement)", () => {
  const connus = { chauffeur: true, vehicule: true };
  it("ticket OCR : 3 écrans de saisie, au plus 5 écrans et 7 interactions", () => {
    expect(ecransDuParcours("ocr", connus)).toEqual(["odometer", "capture-choice", "ocr"]);
    expect(ecransDuParcours("ocr", connus).length + 1).toBeLessThanOrEqual(5); // + écran de confirmation
    expect(interactionsMinimales("ocr", connus)).toBeLessThanOrEqual(7);
  });
  it("plein cuve, cuve scannée : totaliseurs avant et après sur un seul écran", () => {
    const ecrans = ecransDuParcours("cuve", { ...connus, cuve: true });
    expect(ecrans).toEqual(["odometer", "capture-choice", "tank-totalizers", "validate"]);
    expect(interactionsMinimales("cuve", { ...connus, cuve: true })).toBeLessThanOrEqual(7);
  });
  it("plein cuve, cuve à choisir : un écran de plus, jamais deux écrans de totaliseur", () => {
    const ecrans = ecransDuParcours("cuve", connus);
    expect(ecrans).toContain("tank");
    expect(ecrans.filter((e) => e.startsWith("tank-"))).toEqual(["tank-totalizers"]);
  });
  it("avant la refonte : chauffeur et véhicule inconnus ajoutent leurs écrans", () => {
    expect(ecransDuParcours("ocr", { chauffeur: false, vehicule: false })).toEqual(["driver", "vehicle", "odometer", "capture-choice", "ocr"]);
  });
});

describe("dernier relevé connu", () => {
  it("affiche km et date de Paris", () => {
    expect(libelleDernierReleve({ km: 125430, at: "2026-10-12T08:00:00Z" })).toMatch(/^125\s430 km le 12\/10\/2026$/);
  });
  it("sans relevé : rien", () => {
    expect(libelleDernierReleve(null)).toBeNull();
    expect(libelleDernierReleve(undefined)).toBeNull();
  });
});
