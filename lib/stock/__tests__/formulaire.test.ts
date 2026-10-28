import { describe, expect, it } from "vitest";
import { attributsDeModification, corpsDepuisValeurs, valeursDepuisUnite, valeursInitiales } from "@/lib/stock/formulaire";
import { DEFINITION_PROFILS, champsVisibles, resoudreProfil } from "@/lib/stock/profils";

describe("valeurs proposées d'office par le profil", () => {
  it("santé : nature prélèvement, température frais, urgent coché", () => {
    expect(valeursInitiales(DEFINITION_PROFILS.sante)).toMatchObject({ nature: "prelevement", temperature: "frais", urgent: true, fragile: false });
  });
  it("colis : rien de pré-rempli (nature masquée)", () => {
    expect(valeursInitiales(DEFINITION_PROFILS.messagerie)).toMatchObject({ nature: "", temperature: "", urgent: false });
  });
  it("un champ masqué n'est pas pré-rempli, même si le profil a une valeur par défaut", () => {
    const p = resoudreProfil("sante", { version: 1, actifs: ["sante"], profils: { sante: { champs: { temperature: "masque", urgent: "masque" } } } });
    expect(valeursInitiales(p)).toMatchObject({ temperature: "", urgent: false });
  });
  it("sans profil : formulaire vide", () => {
    expect(valeursInitiales(null)).toMatchObject({ nature: "", temperature: "", poids: "" });
  });
});

describe("corps de la requête : seulement les champs du profil", () => {
  const remplis = { ...valeursInitiales(null), poids: "2,5", volume: "0,04", sscc: "376104250000000013", nature: "medicament" as const, temperature: "frais" as const, temperature_releve: "4,5", fragile: true, urgent: true, consigne: " Au frais ", reference_client: "BL-1", lot: "L1", dlc: "2026-11-30" };
  it("colis : poids, volume, référence client, fragile, urgent, consigne ; ni SSCC, ni lot, ni température", () => {
    const c = corpsDepuisValeurs(remplis, DEFINITION_PROFILS.messagerie);
    expect(c).toEqual({ poids_kg: 2.5, volume_m3: 0.04, attributs: { fragile: true, urgent: true, consigne: "Au frais", reference_client: "BL-1" } });
  });
  it("palettes : poids et SSCC", () => {
    const c = corpsDepuisValeurs(remplis, DEFINITION_PROFILS.palettes);
    expect(c.poids_kg).toBe(2.5);
    expect(c.sscc).toBe("376104250000000013");
    expect(c.volume_m3).toBeUndefined();
    expect(c.attributs?.temperature).toBe("frais");
  });
  it("santé : nature, température, température relevée, lot, DLC", () => {
    const c = corpsDepuisValeurs(remplis, DEFINITION_PROFILS.sante);
    expect(c.attributs).toMatchObject({ nature: "medicament", temperature: "frais", temperature_releve: 4.5, lot: "L1", dlc: "2026-11-30", fragile: true, urgent: true });
    expect(c.poids_kg).toBeUndefined();
  });
  it("nature et température « autre » : le libellé libre part avec", () => {
    const c = corpsDepuisValeurs({ ...valeursInitiales(null), nature: "autre", nature_libelle: " Matériel ", temperature: "autre", temperature_libelle: "+15 °C" }, DEFINITION_PROFILS.sante);
    expect(c.attributs).toMatchObject({ nature: "autre", nature_libelle: "Matériel", temperature: "autre", temperature_libelle: "+15 °C" });
    const d = corpsDepuisValeurs({ ...valeursInitiales(null), nature: "colis", nature_libelle: "ignoré" }, DEFINITION_PROFILS.sante);
    expect(d.attributs?.nature_libelle).toBeUndefined();
  });
  it("champs vides non envoyés ; nombres invalides ignorés", () => {
    expect(corpsDepuisValeurs({ ...valeursInitiales(null), poids: "abc" }, DEFINITION_PROFILS.messagerie)).toEqual({});
  });
  it("sans profil : rien n'est envoyé", () => {
    expect(corpsDepuisValeurs(remplis, null)).toEqual({});
  });
  it("tous les champs visibles du profil sont couverts par le formulaire", () => {
    for (const cle of ["messagerie", "palettes", "sante", "personnalise"] as const) {
      const p = DEFINITION_PROFILS[cle];
      expect(champsVisibles(p).length).toBeGreaterThan(0);
    }
  });
});

describe("modification d'une unité : les champs vidés sont effacés", () => {
  const unite = { nature: "prelevement" as const, temperature: "frais" as const, fragile: true, urgent: false, consigne: "Au frais", poids_kg: 2.5 };
  it("relecture puis envoi sans changement : mêmes valeurs", () => {
    const v = valeursDepuisUnite(unite);
    expect(v).toMatchObject({ nature: "prelevement", temperature: "frais", fragile: true, consigne: "Au frais", poids: "2,5" });
    expect(attributsDeModification(v, DEFINITION_PROFILS.sante)).toMatchObject({ nature: "prelevement", temperature: "frais", fragile: true, urgent: false, consigne: "Au frais" });
  });
  it("une consigne vidée est envoyée à null", () => {
    const v = { ...valeursDepuisUnite(unite), consigne: "  " };
    expect(attributsDeModification(v, DEFINITION_PROFILS.sante).consigne).toBeNull();
  });
  it("seuls les champs du profil sont modifiables", () => {
    const a = attributsDeModification(valeursDepuisUnite(unite), DEFINITION_PROFILS.messagerie);
    expect(a).not.toHaveProperty("temperature");
    expect(a).toHaveProperty("fragile");
  });
  it("le libellé libre est effacé quand la nature n'est plus « autre »", () => {
    const a = attributsDeModification({ ...valeursDepuisUnite({ nature: "colis", nature_libelle: "reste" }) }, DEFINITION_PROFILS.sante);
    expect(a.nature_libelle).toBeNull();
  });
  it("valeurs inconnues en base : formulaire vide, pas d'exception", () => {
    expect(valeursDepuisUnite({ nature: "voiture" as never, temperature: "chaud" as never })).toMatchObject({ nature: "", temperature: "" });
  });
});
