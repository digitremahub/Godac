import { describe, expect, it } from "vitest";
import {
  DEFINITION_PROFILS,
  PROFILS,
  activiteDuType,
  avecArticles,
  avecUnites,
  libelleProfils,
  motUnite,
  normaliserProfils,
  sscc,
  typeUniteAutorise,
  typesUniteAutorises,
} from "@/lib/stock/profils";

describe("profils d'activité", () => {
  it("sept profils prédéfinis, dont les trois historiques, avec leur vocabulaire et leurs unités", () => {
    expect(PROFILS).toEqual(["messagerie", "palettes", "sante", "pharmacie", "alimentaire", "vrac", "personnalise"]);
    expect(DEFINITION_PROFILS.messagerie.vocabulaire.un).toBe("colis");
    expect(DEFINITION_PROFILS.messagerie.champs.poids).toBe("affiche");
    expect(DEFINITION_PROFILS.messagerie.champs.volume).toBe("affiche");
    expect(DEFINITION_PROFILS.palettes.vocabulaire.un).toBe("palette");
    expect(DEFINITION_PROFILS.palettes.typesUnite).toEqual(["palette_eur", "demi_palette", "palette_autre"]);
    expect(DEFINITION_PROFILS.palettes.champs.sscc).toBe("affiche");
    expect(DEFINITION_PROFILS.vrac.suivi).toBe("articles");
    expect(DEFINITION_PROFILS.vrac.champs.lot).toBe("affiche");
    expect(DEFINITION_PROFILS.vrac.champs.dlc).toBe("affiche");
  });

  it("normalise une liste : valeurs inconnues et doublons écartés, ordre canonique", () => {
    expect(normaliserProfils(["vrac", "x", "messagerie", "vrac", 3])).toEqual(["messagerie", "vrac"]);
    expect(normaliserProfils(["personnalise", "sante", "pharmacie"])).toEqual(["sante", "pharmacie", "personnalise"]);
    expect(normaliserProfils(null)).toEqual([]);
    expect(normaliserProfils("vrac")).toEqual([]);
  });

  it("plusieurs profils peuvent être actifs ensemble", () => {
    const p = normaliserProfils(["palettes", "messagerie", "vrac"]);
    expect(p).toEqual(["messagerie", "palettes", "vrac"]);
    expect(avecUnites(p)).toBe(true);
    expect(avecArticles(p)).toBe(true);
    expect(typesUniteAutorises(p)).toEqual(["colis", "palette_eur", "demi_palette", "palette_autre"]);
  });

  it("types d'unité permis selon les profils actifs", () => {
    expect(typesUniteAutorises(["messagerie"])).toEqual(["colis"]);
    expect(typesUniteAutorises(["palettes"])).toEqual(["palette_eur", "demi_palette", "palette_autre"]);
    expect(typesUniteAutorises(["vrac"])).toEqual([]);
    expect(typeUniteAutorise(["messagerie"], "palette_eur")).toBe(false);
    expect(typeUniteAutorise(["palettes"], "palette_eur")).toBe(true);
  });

  it("sans profil : rien n'est actif", () => {
    expect(avecUnites([])).toBe(false);
    expect(avecArticles([])).toBe(false);
    expect(libelleProfils([])).toBe("Aucun profil activé");
  });

  it("le vocabulaire suit le profil à unités unique, sinon reste neutre", () => {
    expect(motUnite(["messagerie"]).un).toBe("colis");
    expect(motUnite(["palettes", "vrac"]).un).toBe("palette");
    expect(motUnite(["messagerie", "palettes"]).un).toBe("unité");
    expect(libelleProfils(["messagerie", "vrac"])).toBe("Colis / messagerie · Références en vrac");
    expect(motUnite(["sante"]).un).toBe("échantillon");
    expect(motUnite(["sante", "messagerie"]).un).toBe("unité");
  });

  it("l'activité d'une unité se déduit de son type", () => {
    expect(activiteDuType("colis")).toBe("messagerie");
    expect(activiteDuType("demi_palette")).toBe("palettes");
  });

  it("SSCC : 18 chiffres, préfixe d'application 00 et séparateurs tolérés", () => {
    expect(sscc("376104250000000013")).toBe("376104250000000013");
    expect(sscc("(00) 3761 0425 0000 0000 13")).toBe("376104250000000013");
    expect(sscc("00376104250000000013")).toBe("376104250000000013");
    expect(sscc("12345")).toBeNull();
    expect(sscc("37610425000000001A")).toBeNull();
    expect(sscc(null)).toBeNull();
  });
});
