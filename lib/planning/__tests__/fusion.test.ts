import { describe, expect, it } from "vitest";
import {
  appliquerAttributions,
  appliquerReconciliation,
  cleRamasse,
  elementDuVillage,
  elementsDeFusion,
  estVisiblePour,
  etatElement,
  indexerRepartition,
  ramassesDuVillage,
  reconcilier,
  resumeRepartition,
  texteAAttribuer,
  texteReconciliation,
  toutAttribuer,
  visiblesPour,
  type LigneRepartition,
  type ReelChauffeur,
  type VillageOrigine,
} from "@/lib/planning/fusion";

const village = (id: string, name: string, route_id: string, extra: Partial<VillageOrigine> = {}): VillageOrigine => ({ id, name, route_id, position: 0, ...extra });
const ROUTES = [
  { id: "r1", tour_number: "T101" },
  { id: "r2", tour_number: "T102" },
];
const VILLAGES: VillageOrigine[] = [
  village("v1", "Gignac", "r1", { planned_stops: [{ address: "12 rue des Écoles, Gignac", type: "ramasse" }, { address: "Tabac du centre, Gignac", type: "point_relais" }] }),
  village("v2", "Saint-Jean-de-Fos", "r1", { pickup_addresses: ["3 chemin du Moulin, Saint-Jean-de-Fos"] }),
  village("v3", "Aniane", "r2"),
  // Même village dans deux tournées d'origine : compté une fois.
  village("v4", "ST JEAN DE FOS", "r2"),
];
const { villages, ramasses } = elementsDeFusion(VILLAGES, ROUTES);
const tous = [...villages, ...ramasses];
const ligne = (kind: "village" | "ramasse", cle: string, driver: string | null, statut: "provisoire" | "confirme" = "provisoire", route: string | null = null): LigneRepartition => ({ kind, element_key: cle, element_label: cle, driver_id: driver, route_id: route, statut });
const RAMASSE_ECOLES = cleRamasse("12 rue des Écoles, Gignac");

describe("éléments d'une tournée fusionnée", () => {
  it("rassemble les villages des tournées d'origine sans doublon de commune", () => {
    expect(villages.map((v) => v.label)).toEqual(["Gignac", "Saint-Jean-de-Fos", "Aniane"]);
  });

  it("reprend les ramasses (hors points relais), anciennes et nouvelles, rattachées à leur village", () => {
    expect(ramasses.map((r) => r.label)).toEqual(["12 rue des Écoles, Gignac", "3 chemin du Moulin, Saint-Jean-de-Fos"]);
    expect(ramasses[0]!.villageId).toBe("v1");
    expect(ramassesDuVillage({ planned_stops: [{ address: "ab" }], pickup_addresses: ["12 RUE des écoles, GIGNAC", "12 rue des Ecoles, Gignac"] })).toHaveLength(1);
  });

  it("normalise la clé d'une ramasse comme les arrêts des fiches", () => {
    expect(cleRamasse("12 Rue des Écoles, GIGNAC")).toBe("ramasse:12 rue des ecoles gignac");
  });

  it("retrouve l'élément d'un village par identifiant ou par nom", () => {
    expect(elementDuVillage({ id: "v1", name: "x" }, villages)?.label).toBe("Gignac");
    expect(elementDuVillage({ id: "autre", name: "st jean de fos" }, villages)?.cle).toBe("v2");
    expect(elementDuVillage({ id: "autre", name: "Lodève" }, villages)).toBeNull();
  });
});

describe("répartition : À attribuer par défaut, provisoire ensuite", () => {
  it("tout est À attribuer sans ligne de répartition", () => {
    const index = indexerRepartition([]);
    expect(tous.every((e) => etatElement(e, index) === "a_attribuer")).toBe(true);
    const r = resumeRepartition(tous, []);
    expect(r).toMatchObject({ total: 5, aAttribuer: 5, villagesAAttribuer: 3, ramassesAAttribuer: 2 });
    expect(texteAAttribuer(r)).toBe("3 villages et 2 ramasses à attribuer");
  });

  it("une attribution est provisoire et retire l'élément des À attribuer", () => {
    const { ecrire, supprimer } = appliquerAttributions(tous, [], [{ kind: "village", cle: "v1", label: "Gignac", driver_id: "a", route_id: null }]);
    expect(supprimer).toEqual([]);
    expect(ecrire).toEqual([{ kind: "village", element_key: "v1", element_label: "Gignac", driver_id: "a", route_id: null, statut: "provisoire" }]);
    expect(resumeRepartition(tous, ecrire)).toMatchObject({ aAttribuer: 4, provisoires: 1 });
    expect(texteAAttribuer(resumeRepartition(tous, ecrire))).toBe("2 villages et 2 ramasses à attribuer");
    expect(texteAAttribuer(resumeRepartition(tous, appliquerAttributions(tous, [], toutAttribuer(tous, "a")).ecrire))).toBe("Tout est attribué");
  });

  it("une tournée réelle sans chauffeur attribue aussi (état provisoire)", () => {
    const { ecrire } = appliquerAttributions(tous, [], [{ kind: "village", cle: "v3", label: "Aniane", driver_id: null, route_id: "r2" }]);
    expect(etatElement(villages[2]!, indexerRepartition(ecrire))).toBe("provisoire");
  });

  it("chauffeur et tournée vides : retour à À attribuer", () => {
    const avant = [ligne("village", "v1", "a")];
    const { ecrire, supprimer } = appliquerAttributions(tous, avant, [{ kind: "village", cle: "v1", label: "Gignac", driver_id: null, route_id: null }]);
    expect(ecrire).toEqual([]);
    expect(supprimer).toEqual([{ kind: "village", element_key: "v1" }]);
  });

  it("garde le statut confirmé si la cible ne change pas, repasse en provisoire si elle change", () => {
    const avant = [ligne("village", "v1", "a", "confirme")];
    expect(appliquerAttributions(tous, avant, [{ kind: "village", cle: "v1", label: "", driver_id: "a", route_id: null }]).ecrire[0]!.statut).toBe("confirme");
    expect(appliquerAttributions(tous, avant, [{ kind: "village", cle: "v1", label: "", driver_id: "b", route_id: null }]).ecrire[0]!.statut).toBe("provisoire");
  });

  it("ignore ce qui n'appartient pas à la fusion", () => {
    const { ecrire, supprimer } = appliquerAttributions(tous, [], [{ kind: "village", cle: "inconnu", label: "", driver_id: "a", route_id: null }]);
    expect(ecrire).toEqual([]);
    expect(supprimer).toEqual([]);
  });

  it("« tout attribuer à » couvre villages et ramasses", () => {
    expect(toutAttribuer(tous, "a")).toHaveLength(5);
    expect(appliquerAttributions(tous, [], toutAttribuer(tous, "a")).ecrire).toHaveLength(5);
  });
});

describe("fiche colis : un chauffeur ne voit que ses villages et ses ramasses", () => {
  it("avant toute attribution, tous les chauffeurs de la fusion voient tout (rien ne se perd)", () => {
    const v = visiblesPour("a", { villages, ramasses }, []);
    expect([...v.villageIds].sort()).toEqual(["v1", "v2", "v3"]);
    expect(v.ramasseCles.size).toBe(2);
  });

  it("un village attribué à un autre chauffeur disparaît de la fiche", () => {
    const lignes = [ligne("village", "v1", "b"), ligne("village", "v3", "a")];
    const pourA = visiblesPour("a", { villages, ramasses }, lignes);
    expect([...pourA.villageIds].sort()).toEqual(["v2", "v3"]);
    const pourB = visiblesPour("b", { villages, ramasses }, lignes);
    expect([...pourB.villageIds].sort()).toEqual(["v1", "v2"]);
  });

  it("une ramasse « À attribuer » suit son village", () => {
    const lignes = [ligne("village", "v1", "b")];
    expect(visiblesPour("a", { villages, ramasses }, lignes).ramasseCles.has(RAMASSE_ECOLES)).toBe(false);
    expect(visiblesPour("b", { villages, ramasses }, lignes).ramasseCles.has(RAMASSE_ECOLES)).toBe(true);
  });

  it("une ramasse attribuée à un chauffeur lui est réservée et emmène son village", () => {
    const lignes = [ligne("village", "v1", "b"), ligne("ramasse", RAMASSE_ECOLES, "a")];
    const pourA = visiblesPour("a", { villages, ramasses }, lignes);
    expect(pourA.ramasseCles.has(RAMASSE_ECOLES)).toBe(true);
    expect(pourA.villageIds.has("v1")).toBe(true);
    expect(visiblesPour("b", { villages, ramasses }, lignes).ramasseCles.has(RAMASSE_ECOLES)).toBe(false);
  });

  it("une tournée réelle sans chauffeur ne retire rien", () => {
    expect(estVisiblePour("a", ligne("village", "v1", null, "provisoire", "r1"))).toBe(true);
  });
});

describe("réconciliation prévu / réel", () => {
  const reel = (driverId: string, villageIds: string[], rs: { cle: string; faite: boolean }[] = []): ReelChauffeur => ({ driverId, villageIds, ramasses: rs });

  it("conforme : le chauffeur prévu l'a fait", () => {
    const r = reconcilier(tous, [ligne("village", "v1", "a", "confirme")], [reel("a", ["v1"])]);
    expect(r.ecarts.find((e) => e.cle === "v1")!.nature).toBe("conforme");
    expect(r.propositions.find((p) => p.cle === "v1")).toBeUndefined();
  });

  it("conforme mais encore provisoire : proposition de confirmation", () => {
    const r = reconcilier(tous, [ligne("village", "v1", "a")], [reel("a", ["v1"])]);
    expect(r.resume.aConfirmer).toBe(1);
    expect(r.propositions).toEqual([{ kind: "village", cle: "v1", label: "Gignac", driver_id: "a", route_id: null }]);
  });

  it("À attribuer résolu par le réel", () => {
    const r = reconcilier(tous, [], [reel("b", ["v3"])]);
    const e = r.ecarts.find((x) => x.cle === "v3")!;
    expect(e.nature).toBe("a_attribuer_resolu");
    expect(e.reel).toEqual(["b"]);
    expect(r.propositions.some((p) => p.cle === "v3" && p.driver_id === "b")).toBe(true);
  });

  it("écart : un autre chauffeur l'a réellement fait", () => {
    const r = reconcilier(tous, [ligne("village", "v2", "a")], [reel("b", ["v2"])]);
    const e = r.ecarts.find((x) => x.cle === "v2")!;
    expect(e).toMatchObject({ nature: "autre_chauffeur", prevu: "a", reel: ["b"] });
    expect(r.resume.autres).toBe(1);
  });

  it("deux chauffeurs sur le même village : à corriger à la main, rien n'est proposé", () => {
    const r = reconcilier(tous, [ligne("village", "v1", "a")], [reel("a", ["v1"]), reel("b", ["v1"])]);
    expect(r.ecarts.find((x) => x.cle === "v1")!.nature).toBe("plusieurs_chauffeurs");
    expect(r.propositions.some((p) => p.cle === "v1")).toBe(false);
  });

  it("pas encore de fiche : non réalisé, rien n'est proposé", () => {
    const r = reconcilier(tous, [ligne("village", "v1", "a")], []);
    expect(r.resume.nonRealises).toBe(5);
    expect(r.propositions).toEqual([]);
  });

  it("ramasses : présence sur la fiche et ramasse faite", () => {
    const r = reconcilier(tous, [ligne("ramasse", RAMASSE_ECOLES, "a")], [reel("a", [], [{ cle: RAMASSE_ECOLES, faite: true }])]);
    const e = r.ecarts.find((x) => x.cle === RAMASSE_ECOLES)!;
    expect(e).toMatchObject({ nature: "conforme", faite: true });
  });

  it("résumé lisible des écarts", () => {
    const r = reconcilier(tous, [ligne("village", "v1", "a", "confirme"), ligne("village", "v2", "a")], [reel("a", ["v1"]), reel("b", ["v2", "v3"])]);
    expect(texteReconciliation(r.resume)).toBe("1 conforme, 2 écarts (1 autre chauffeur, 1 était à attribuer), 2 pas encore sur une fiche");
    expect(texteReconciliation({ conformes: 0, resolus: 0, autres: 0, plusieurs: 0, nonRealises: 0, aConfirmer: 0 })).toBe("Rien à comparer");
  });

  it("appliquer aligne la répartition sur le réel (confirmée) et garde la tournée réelle choisie", () => {
    const lignes = [ligne("village", "v2", "a", "provisoire", "r1")];
    const r = reconcilier(tous, lignes, [reel("b", ["v2", "v3"])]);
    const nouvelles = appliquerReconciliation(tous, lignes, r.propositions);
    expect(nouvelles.find((l) => l.element_key === "v2")).toMatchObject({ driver_id: "b", route_id: "r1", statut: "confirme" });
    expect(nouvelles.find((l) => l.element_key === "v3")).toMatchObject({ driver_id: "b", statut: "confirme" });
    // Une fois alignée, la réconciliation ne propose plus rien.
    const apres = reconcilier(tous, nouvelles, [reel("b", ["v2", "v3"])]);
    expect(apres.propositions).toEqual([]);
    expect(apres.resume.conformes).toBe(2);
  });
});
