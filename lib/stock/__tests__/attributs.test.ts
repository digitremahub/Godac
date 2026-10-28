import { describe, expect, it } from "vitest";
import {
  AVERTISSEMENT_DONNEES_SANTE,
  CONSIGNE_MAX,
  LIBELLES_NATURE,
  LIBELLES_TEMPERATURE,
  LIBELLE_LIBRE_MAX,
  MENTION_SUIVI_LOGISTIQUE,
  NATURES,
  TEMPERATURES,
  attributsPourRpc,
  libelleNature,
  libelleTemperature,
  resumeAttributs,
  schemaAttributs,
} from "@/lib/stock/attributs";

describe("listes", () => {
  it("natures : colis, palette, prélèvement / échantillon biologique, médicament, produit alimentaire, produit pharmaceutique, autre", () => {
    expect([...NATURES]).toEqual(["colis", "palette", "prelevement", "medicament", "alimentaire", "pharmaceutique", "autre"]);
    expect(LIBELLES_NATURE.prelevement).toMatch(/échantillon biologique/);
    expect(LIBELLES_NATURE.alimentaire).toBe("Produit alimentaire");
    expect(LIBELLES_NATURE.pharmaceutique).toBe("Produit pharmaceutique");
  });
  it("températures : ambiante, frais 2 à 8 °C, congelé, autre", () => {
    expect([...TEMPERATURES]).toEqual(["ambiante", "frais", "congele", "autre"]);
    expect(LIBELLES_TEMPERATURE.frais).toBe("Frais (2 à 8 °C)");
  });
  it("limites : libellé libre 60, consigne 120", () => {
    expect(LIBELLE_LIBRE_MAX).toBe(60);
    expect(CONSIGNE_MAX).toBe(120);
  });
});

describe("validation des attributs", () => {
  it("accepte des attributs complets", () => {
    const r = schemaAttributs.safeParse({ nature: "prelevement", temperature: "frais", temperature_releve: 4.5, fragile: true, urgent: true, consigne: "Livrer avant 10 h", reference_client: "BL-1", lot: "L1", dlc: "2026-11-30" });
    expect(r.success).toBe(true);
  });
  it("accepte « autre » avec un libellé libre de 60 caractères", () => {
    expect(schemaAttributs.safeParse({ nature: "autre", nature_libelle: "x".repeat(60), temperature: "autre", temperature_libelle: "+15 °C" }).success).toBe(true);
    expect(schemaAttributs.safeParse({ nature: "autre", nature_libelle: "x".repeat(61) }).success).toBe(false);
  });
  it("consigne : 120 caractères au plus", () => {
    expect(schemaAttributs.safeParse({ consigne: "x".repeat(120) }).success).toBe(true);
    expect(schemaAttributs.safeParse({ consigne: "x".repeat(121) }).success).toBe(false);
  });
  it("refuse une nature ou une température inconnue, une clé inconnue, une température relevée absurde, une DLC mal formée", () => {
    expect(schemaAttributs.safeParse({ nature: "cadavre" }).success).toBe(false);
    expect(schemaAttributs.safeParse({ temperature: "chaud" }).success).toBe(false);
    expect(schemaAttributs.safeParse({ patient: "Dupont" }).success).toBe(false);
    expect(schemaAttributs.safeParse({ temperature_releve: 150 }).success).toBe(false);
    expect(schemaAttributs.safeParse({ temperature_releve: -101 }).success).toBe(false);
    expect(schemaAttributs.safeParse({ dlc: "30/11/2026" }).success).toBe(false);
    expect(schemaAttributs.safeParse({ fragile: "oui" }).success).toBe(false);
  });
  it("tous les champs sont facultatifs", () => {
    expect(schemaAttributs.safeParse({}).success).toBe(true);
  });
});

describe("libellés et résumé", () => {
  it("libellé libre pour « autre », sinon le libellé de la liste", () => {
    expect(libelleNature("autre", " Matériel ")).toBe("Matériel");
    expect(libelleNature("autre", "")).toBe("Autre");
    expect(libelleNature("colis", "ignoré")).toBe("Colis");
    expect(libelleNature(null)).toBe("");
    expect(libelleTemperature("frais", null, true)).toBe("2-8 °C");
    expect(libelleTemperature("autre", "+15 °C")).toBe("+15 °C");
  });
  it("résumé affiché dans la liste", () => {
    expect(resumeAttributs({ nature: "prelevement", temperature: "frais", fragile: true, urgent: true })).toBe("Prélèvement · 2-8 °C · fragile · urgent");
    expect(resumeAttributs({})).toBe("");
    expect(resumeAttributs(null)).toBe("");
  });
});

describe("attributs envoyés à la fonction SQL", () => {
  it("rien à envoyer : null", () => {
    expect(attributsPourRpc(null)).toBeNull();
    expect(attributsPourRpc({})).toBeNull();
  });
  it("les chaînes vides effacent la valeur, les espaces sont retirés", () => {
    expect(attributsPourRpc({ consigne: "  ", reference_client: " BL-1 " })).toEqual({ consigne: null, reference_client: "BL-1" });
  });
  it("le libellé libre n'est envoyé que pour la nature ou la température « autre »", () => {
    expect(attributsPourRpc({ nature: "colis", nature_libelle: "x" })).toEqual({ nature: "colis", nature_libelle: null });
    expect(attributsPourRpc({ nature: "autre", nature_libelle: "Matériel" })).toEqual({ nature: "autre", nature_libelle: "Matériel" });
    expect(attributsPourRpc({ temperature: "frais", temperature_libelle: "x" })).toEqual({ temperature: "frais", temperature_libelle: null });
  });
  it("un libellé seul (sans la nature) est transmis tel quel", () => {
    expect(attributsPourRpc({ nature_libelle: "Matériel" })).toEqual({ nature_libelle: "Matériel" });
  });
});

describe("mentions", () => {
  it("suivi logistique : aucune promesse de conformité réglementaire", () => {
    expect(MENTION_SUIVI_LOGISTIQUE).toMatch(/suivi logistique/);
    expect(MENTION_SUIVI_LOGISTIQUE).toMatch(/à la charge de l'entreprise/);
    expect(MENTION_SUIVI_LOGISTIQUE).toMatch(/chaîne du froid/);
    expect(MENTION_SUIVI_LOGISTIQUE).toMatch(/ne garantit aucune conformité/);
  });
  it("avertissement : pas de donnée de santé nominative dans les champs libres", () => {
    expect(AVERTISSEMENT_DONNEES_SANTE).toMatch(/donnée de santé nominative/);
  });
});
