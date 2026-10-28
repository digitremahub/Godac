import { describe, expect, it } from "vitest";
import { DEFINITION_FORMATS } from "@/lib/stock/formats-etiquette";
import {
  CHAMPS_ETIQUETTE,
  CHAMPS_OUI_NON,
  CHAMPS_STOCK,
  CONFIG_VIDE,
  DEFINITION_PROFILS,
  PROFILS,
  avecArticles,
  avecUnites,
  champsManquants,
  champsObligatoires,
  champsVisibles,
  differencesProfil,
  famillesDe,
  lireProfilsConfig,
  messageChampsManquants,
  motUnite,
  profilsArticles,
  profilsEffectifs,
  profilsUnites,
  resoudreProfil,
  schemaConfigProfil,
  schemaProfilsConfig,
  typesUniteAutorises,
  type ProfilsConfig,
} from "@/lib/stock/profils";

describe("catalogue : valeurs par défaut sensées par métier", () => {
  it("médicaments et alimentaire : lot et DLC obligatoires, FEFO, alerte DLC proche", () => {
    for (const cle of ["pharmacie", "alimentaire"] as const) {
      const p = DEFINITION_PROFILS[cle];
      expect(p.suivi, cle).toBe("articles");
      expect(p.champs.lot, cle).toBe("requis");
      expect(p.champs.dlc, cle).toBe("requis");
      expect(p.fefo, cle).toBe(true);
      expect(p.alertes.dlcJours, cle).not.toBeNull();
      expect(p.alertes.seuilMini, cle).toBe(true);
    }
    expect(DEFINITION_PROFILS.pharmacie.alertes.dlcJours).toBe(90);
    expect(DEFINITION_PROFILS.alimentaire.alertes.dlcJours).toBe(7);
  });
  it("santé (prélèvements, produits biologiques, sang) : température obligatoire, urgent par défaut, vocabulaire adapté, étiquette sans donnée nominative", () => {
    const p = DEFINITION_PROFILS.sante;
    expect(p.suivi).toBe("unites");
    expect(p.champs.temperature).toBe("requis");
    expect(p.defauts).toEqual({ nature: "prelevement", temperature: "frais", urgent: true });
    expect(p.vocabulaire.un).toBe("échantillon");
    expect(p.etiquette.champs).not.toContain("reference_client");
    expect(p.avertissement).toMatch(/donnée de santé nominative/);
    expect(p.avertissement).toMatch(/à la charge de l'entreprise/);
    // Rien de nominatif n'existe parmi les champs imprimables.
    expect(JSON.stringify(CHAMPS_ETIQUETTE)).not.toMatch(/nom_patient|patient|donneur/);
  });
  it("palettes : SSCC, type de palette ; colis : poids et volume", () => {
    expect(DEFINITION_PROFILS.palettes.champs.sscc).toBe("affiche");
    expect(DEFINITION_PROFILS.palettes.typesUnite).toEqual(["palette_eur", "demi_palette", "palette_autre"]);
    expect(DEFINITION_PROFILS.messagerie.champs.poids).toBe("affiche");
    expect(DEFINITION_PROFILS.messagerie.champs.volume).toBe("affiche");
  });
  it("personnalisé : neutre, suivi d'unités par défaut", () => {
    const p = DEFINITION_PROFILS.personnalise;
    expect(champsObligatoires(p)).toEqual([]);
    expect(p.suivi).toBe("unites");
    expect(p.fefo).toBe(false);
  });
  it("chaque profil a un format d'étiquette existant, des champs d'étiquette connus et des vocabulaires non vides", () => {
    for (const cle of PROFILS) {
      const p = DEFINITION_PROFILS[cle];
      expect(p.cle).toBe(cle);
      expect(Object.keys(DEFINITION_FORMATS)).toContain(p.etiquette.format);
      for (const c of p.etiquette.champs) expect(CHAMPS_ETIQUETTE).toContain(c);
      expect(p.vocabulaire.un.length).toBeGreaterThan(0);
      expect(p.vocabulaire.plusieurs.length).toBeGreaterThan(0);
      expect(Object.keys(p.champs).sort()).toEqual([...CHAMPS_STOCK].sort());
    }
  });
  it("aucun champ « oui / non » n'est obligatoire par défaut", () => {
    for (const cle of PROFILS) for (const c of CHAMPS_OUI_NON) expect(DEFINITION_PROFILS[cle].champs[c], `${cle}.${c}`).not.toBe("requis");
  });
  it("seule la mention de suivi logistique est faite : aucune promesse de conformité dans le catalogue", () => {
    const texte = JSON.stringify(DEFINITION_PROFILS).toLowerCase();
    expect(texte).not.toMatch(/gdp|conforme aux|certifi|garantit|iso 9001|haccp|cofrac/);
  });
});

describe("personnalisation sans code : vocabulaire, champs, alertes, étiquette", () => {
  const config = (profils: ProfilsConfig["profils"], actifs: ProfilsConfig["actifs"] = ["messagerie"]): ProfilsConfig => ({ version: 1, actifs, profils });
  it("sans ajustement, le profil effectif est celui du catalogue", () => {
    expect(resoudreProfil("messagerie", null)).toBe(DEFINITION_PROFILS.messagerie);
    expect(resoudreProfil("messagerie", CONFIG_VIDE)).toBe(DEFINITION_PROFILS.messagerie);
  });
  it("(a) vocabulaire : poche, bac, boîte…", () => {
    const p = resoudreProfil("sante", config({ sante: { vocabulaire: { un: "poche", plusieurs: "poches" } } }, ["sante"]));
    expect(p.vocabulaire).toMatchObject({ un: "poche", plusieurs: "poches" });
    expect(p.vocabulaire.code).toBe(DEFINITION_PROFILS.sante.vocabulaire.code);
    expect(motUnite(["sante"], config({ sante: { vocabulaire: { un: "poche", plusieurs: "poches" } } }, ["sante"])).un).toBe("poche");
  });
  it("(b) champs affichés et obligatoires", () => {
    const p = resoudreProfil("messagerie", config({ messagerie: { champs: { poids: "requis", volume: "masque", sscc: "affiche" } } }));
    expect(p.champs).toMatchObject({ poids: "requis", volume: "masque", sscc: "affiche", reference_client: "affiche" });
    expect(champsObligatoires(p)).toEqual(["poids"]);
    expect(champsVisibles(p)).toContain("sscc");
    expect(champsVisibles(p)).not.toContain("volume");
  });
  it("(b) un champ obligatoire par défaut peut être rendu facultatif", () => {
    const p = resoudreProfil("pharmacie", config({ pharmacie: { champs: { dlc: "affiche" } } }, ["pharmacie"]));
    expect(champsObligatoires(p)).toEqual(["lot"]);
  });
  it("(c) règles d'alerte : DLC à J-n, seuil mini, non rentrées, écart d'inventaire", () => {
    const p = resoudreProfil("alimentaire", config({ alimentaire: { alertes: { dlc_jours: 3, seuil_mini: false, ecart_inventaire: false } } }, ["alimentaire"]));
    expect(p.alertes).toEqual({ dlcJours: 3, seuilMini: false, nonRentre: false, ecartInventaire: false });
    const sans = resoudreProfil("alimentaire", config({ alimentaire: { alertes: { dlc_jours: null } } }, ["alimentaire"]));
    expect(sans.alertes.dlcJours).toBeNull();
  });
  it("(d) contenu de l'étiquette et (e) format par défaut", () => {
    const p = resoudreProfil("messagerie", config({ messagerie: { etiquette: { champs: ["consigne", "urgent"], format: "thermique_100x150" } } }));
    expect(p.etiquette).toEqual({ champs: ["consigne", "urgent"], format: "thermique_100x150" });
  });
  it("FEFO activable ou non", () => {
    expect(resoudreProfil("vrac", config({ vrac: { fefo: false } }, ["vrac"])).fefo).toBe(false);
    expect(resoudreProfil("messagerie", config({ messagerie: { fefo: true } })).fefo).toBe(true);
  });
  it("« personnalisé » peut suivre des articles ; les autres profils gardent leur suivi", () => {
    const p = resoudreProfil("personnalise", config({ personnalise: { suivi: "articles" } }, ["personnalise"]));
    expect(p.suivi).toBe("articles");
    expect(p.famille).toBe("vrac");
    expect(p.typesUnite).toEqual([]);
    // Le suivi n'est ajustable que pour « personnalisé » : ailleurs la valeur est ignorée.
    expect(resoudreProfil("messagerie", config({ messagerie: { suivi: "articles" } })).suivi).toBe("unites");
  });
  it("profils actifs : unités et articles se déduisent de la configuration", () => {
    const c = config({ personnalise: { suivi: "articles" } }, ["messagerie", "personnalise"]);
    expect(profilsUnites(["messagerie", "personnalise"], c)).toEqual(["messagerie"]);
    expect(profilsArticles(["messagerie", "personnalise"], c)).toEqual(["personnalise"]);
    expect(avecUnites(["personnalise"], c)).toBe(false);
    expect(avecArticles(["personnalise"], c)).toBe(true);
    expect(typesUniteAutorises(["messagerie", "personnalise"], c)).toEqual(["colis"]);
    expect(profilsEffectifs(["messagerie", "personnalise"], c).map((p) => p.cle)).toEqual(["messagerie", "personnalise"]);
  });
  it("familles historiques : la colonne profils de la base reste dans messagerie / palettes / vrac", () => {
    expect(famillesDe(["sante", "pharmacie", "alimentaire", "personnalise"])).toEqual(["messagerie", "vrac"]);
    expect(famillesDe(["palettes", "messagerie"])).toEqual(["messagerie", "palettes"]);
    expect(famillesDe([])).toEqual([]);
    for (const cle of PROFILS) expect(["messagerie", "palettes", "vrac"]).toContain(DEFINITION_PROFILS[cle].famille);
  });
});

describe("différences enregistrées (seules les modifications)", () => {
  it("catalogue inchangé : aucune différence", () => {
    for (const cle of PROFILS) expect(differencesProfil(cle, DEFINITION_PROFILS[cle])).toEqual({});
  });
  it("le profil édité se ramène à ses seules différences, et se relit à l'identique", () => {
    const base = DEFINITION_PROFILS.sante;
    const edite = { ...base, vocabulaire: { ...base.vocabulaire, un: "poche", plusieurs: "poches" }, champs: { ...base.champs, lot: "requis" as const }, alertes: { ...base.alertes, dlcJours: 1 }, etiquette: { champs: ["entreprise", "urgent"] as never, format: "thermique_100x150" as const } };
    const diff = differencesProfil("sante", edite);
    expect(diff).toEqual({ vocabulaire: { un: "poche", plusieurs: "poches" }, champs: { lot: "requis" }, alertes: { dlc_jours: 1 }, etiquette: { champs: ["entreprise", "urgent"], format: "thermique_100x150" } });
    expect(schemaConfigProfil.safeParse(diff).success).toBe(true);
    const relu = resoudreProfil("sante", { version: 1, actifs: ["sante"], profils: { sante: diff } });
    expect(relu.vocabulaire.un).toBe("poche");
    expect(relu.champs.lot).toBe("requis");
    expect(relu.alertes.dlcJours).toBe(1);
    expect(relu.etiquette.format).toBe("thermique_100x150");
  });
  it("l'ordre des champs d'étiquette ne compte pas", () => {
    const base = DEFINITION_PROFILS.messagerie;
    expect(differencesProfil("messagerie", { ...base, etiquette: { ...base.etiquette, champs: [...base.etiquette.champs].reverse() } })).toEqual({});
  });
});

describe("validation de la configuration (zod côté API)", () => {
  const ok = (v: unknown) => schemaConfigProfil.safeParse(v).success;
  it("accepte une configuration valide", () => {
    expect(ok({})).toBe(true);
    expect(ok({ vocabulaire: { un: "bac", plusieurs: "bacs" }, champs: { poids: "requis", fragile: "affiche" }, alertes: { dlc_jours: 30, seuil_mini: true }, etiquette: { champs: ["entreprise"], format: "a4_2x4" }, fefo: true })).toBe(true);
  });
  it("refuse un champ « oui / non » obligatoire", () => {
    const r = schemaConfigProfil.safeParse({ champs: { fragile: "requis" } });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0]!.message).toMatch(/ne peut pas être obligatoire/);
    expect(ok({ champs: { urgent: "requis" } })).toBe(false);
  });
  it("refuse les valeurs hors liste ou hors limites", () => {
    expect(ok({ champs: { poids: "obligatoire" } })).toBe(false);
    expect(ok({ champs: { inconnu: "requis" } })).toBe(false);
    expect(ok({ alertes: { dlc_jours: 0 } })).toBe(false);
    expect(ok({ alertes: { dlc_jours: 366 } })).toBe(false);
    expect(ok({ alertes: { dlc_jours: 1.5 } })).toBe(false);
    expect(ok({ etiquette: { format: "a3" } })).toBe(false);
    expect(ok({ etiquette: { champs: ["nom_patient"] } })).toBe(false);
    expect(ok({ vocabulaire: { un: "", plusieurs: "x" } })).toBe(false);
    expect(ok({ vocabulaire: { un: "x".repeat(31), plusieurs: "x" } })).toBe(false);
    expect(ok({ n_importe_quoi: 1 })).toBe(false);
  });
  it("configuration complète : version, profils actifs, profils connus seulement", () => {
    expect(schemaProfilsConfig.safeParse({ version: 1, actifs: ["sante"], profils: { sante: {} } }).success).toBe(true);
    expect(schemaProfilsConfig.safeParse({ version: 2, actifs: [], profils: {} }).success).toBe(false);
    expect(schemaProfilsConfig.safeParse({ version: 1, actifs: ["labo"], profils: {} }).success).toBe(false);
    expect(schemaProfilsConfig.safeParse({ version: 1, actifs: [], profils: { labo: {} } }).success).toBe(false);
  });
  it("lecture tolérante d'un jsonb abîmé : aucune exception, profils actifs récupérés", () => {
    expect(lireProfilsConfig({})).toEqual(CONFIG_VIDE);
    expect(lireProfilsConfig(null)).toEqual(CONFIG_VIDE);
    expect(lireProfilsConfig("x")).toEqual(CONFIG_VIDE);
    expect(lireProfilsConfig({ version: 1, actifs: ["vrac", "faux"], profils: { vrac: { champs: { lot: "nimporte" } } } })).toEqual({ version: 1, actifs: ["vrac"], profils: {} });
    expect(lireProfilsConfig({ version: 1, actifs: ["pharmacie", "sante"], profils: {} }).actifs).toEqual(["sante", "pharmacie"]);
  });
});

describe("champs obligatoires", () => {
  it("détecte les champs manquants (vide, espaces, null)", () => {
    const p = DEFINITION_PROFILS.pharmacie;
    expect(champsManquants(p, { lot: "", dlc: null })).toEqual(["lot", "dlc"]);
    expect(champsManquants(p, { lot: "  ", dlc: "2026-12-31" })).toEqual(["lot"]);
    expect(champsManquants(p, { lot: "L1", dlc: "2026-12-31" })).toEqual([]);
    expect(champsManquants(DEFINITION_PROFILS.sante, { temperature: "" })).toEqual(["temperature"]);
    expect(champsManquants(DEFINITION_PROFILS.messagerie, {})).toEqual([]);
  });
  it("message clair en français", () => {
    expect(messageChampsManquants(DEFINITION_PROFILS.sante, ["temperature"])).toBe("Champ obligatoire pour le profil Santé : prélèvements et produits biologiques (dont sang) : « Température cible ».");
    expect(messageChampsManquants(DEFINITION_PROFILS.pharmacie, ["lot", "dlc"])).toMatch(/Champs obligatoires.*« Lot », « Date limite \(DLC\) »/);
  });
});
