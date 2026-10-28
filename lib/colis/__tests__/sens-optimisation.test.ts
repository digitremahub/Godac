import { describe, expect, it } from "vitest";
import { ordonnerListesGlobalement } from "@/lib/colis/tournee-globale";
import { sequenceParListes } from "@/lib/colis/listes";
import { distanceKm, type Point } from "@/lib/colis/optimisation";
import { LAMBDA_MAX, cleSecteur } from "@/lib/colis/sens-tournee";

const depot: Point = { lat: 45, lng: 5 };
const pt = (dx: number, dy: number): Point => ({ lat: 45 + dy / 111.2, lng: 5 + dx / (111.2 * Math.cos((45 * Math.PI) / 180)) });
let n = 0;
const arret = (list_id: string, p: Point) => ({ id: `s${n++}`, list_id, position: n, status: "pending", lat: p.lat, lng: p.lng });
const ids = (r: { listes: { id: string }[] }) => r.listes.map((l) => l.id).filter((id) => id !== "V");
const ref = (...noms: string[]) => noms.map(cleSecteur);

describe("ordonnerListesGlobalement avec un sens habituel", () => {
  // Deux villages symétriques de part et d'autre du dépôt : l'ordre ne change pas la longueur.
  const listes = [
    { id: "E", name: "Est", position: 0 },
    { id: "O", name: "Ouest", position: 1 },
    { id: "V", name: "Vide", position: 2 },
  ];
  const arrets = [arret("E", pt(10, 0)), arret("E", pt(11, 0)), arret("O", pt(-10, 0)), arret("O", pt(-11, 0))];

  it("à longueur égale, l'ordre habituel départage", () => {
    const estD = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, undefined, { reference: ref("Est", "Ouest") });
    const ouestD = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, undefined, { reference: ref("Ouest", "Est") });
    expect(ids(estD)).toEqual(["E", "O"]);
    expect(ids(ouestD)).toEqual(["O", "E"]);
    expect(estD.desordreSens).toBe(0);
    expect(ouestD.desordreSens).toBe(0);
  });

  it("le sens inversé (référence à l'envers) est suivi de la même façon", () => {
    const r = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, undefined, { reference: ref("Est", "Ouest").reverse() });
    expect(ids(r)).toEqual(["O", "E"]);
  });

  it("sans sens, le résultat est celui de toujours (aucun champ ajouté)", () => {
    const sans = ordonnerListesGlobalement(arrets, listes, depot, false);
    const vide = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, undefined, { reference: [] });
    expect(ids(vide)).toEqual(ids(sans));
    expect(sans.desordreSens).toBeUndefined();
    expect(vide.desordreSens).toBeUndefined();
  });
});

describe("le biais reste doux : jamais de détour manifeste", () => {
  // Trois villages alignés vers l'est (10, 20, 30 km), sans retour : A → B → C est de loin le plus court.
  const listes = [
    { id: "C", name: "Village C", position: 0 },
    { id: "A", name: "Village A", position: 1 },
    { id: "B", name: "Village B", position: 2 },
  ];
  const ligne = [arret("A", pt(10, 0)), arret("A", pt(11, 1)), arret("B", pt(20, 0)), arret("B", pt(21, -1)), arret("C", pt(30, 0)), arret("C", pt(31, 1))];

  it("une habitude à contre-sens qui rallonge fortement la tournée n'est pas retenue", () => {
    const r = ordonnerListesGlobalement(ligne, listes, depot, false, distanceKm, undefined, { reference: ref("Village C", "Village B", "Village A") });
    expect(ids(r)).toEqual(["A", "B", "C"]);
    expect(r.desordreSens).toBe(1);
  });

  it("l'habitude est suivie quand elle ne coûte presque rien (moins de 4 %)", () => {
    // P à 10 km à l'est, Q à 10,2 km à l'ouest : P→Q 30,2 km, Q→P 30,4 km (+0,7 %).
    const l2 = [
      { id: "P", name: "Village P", position: 0 },
      { id: "Q", name: "Village Q", position: 1 },
    ];
    const a2 = [arret("P", pt(10, 0)), arret("P", pt(10.1, 0)), arret("Q", pt(-10.2, 0)), arret("Q", pt(-10.3, 0))];
    const libre = ordonnerListesGlobalement(a2, l2, depot, false);
    const habitude = ordonnerListesGlobalement(a2, l2, depot, false, distanceKm, undefined, { reference: ref("Village Q", "Village P") });
    expect(ids(libre)).toEqual(["P", "Q"]);
    expect(ids(habitude)).toEqual(["Q", "P"]);
    expect(habitude.km).toBeLessThan(libre.km * 1.04);
  });

  it("même avec un poids excessif, le biais est plafonné à 10 % de longueur", () => {
    const r = ordonnerListesGlobalement(ligne, listes, depot, false, distanceKm, undefined, { reference: ref("Village C", "Village B", "Village A"), lambda: 50 });
    // Le contre-sens fait 50 km contre 30 : très au-delà de 10 %.
    expect(ids(r)).toEqual(["A", "B", "C"]);
    const libre = ordonnerListesGlobalement(ligne, listes, depot, false);
    expect(r.km).toBeLessThanOrEqual(libre.km * (1 + LAMBDA_MAX));
  });

  it("un village nouveau, absent de l'habitude, ne casse pas l'ordre des villages connus", () => {
    const l3 = [
      { id: "A", name: "Village A", position: 0 },
      { id: "B", name: "Village B", position: 1 },
      { id: "N", name: "Nouveau", position: 2 },
    ];
    const a3 = [arret("A", pt(10, 0)), arret("A", pt(11, 0)), arret("B", pt(20, 0)), arret("B", pt(21, 0)), arret("N", pt(15, 5)), arret("N", pt(16, 5))];
    const r = ordonnerListesGlobalement(a3, l3, depot, false, distanceKm, undefined, { reference: ref("Village A", "Village B") });
    const ordre = ids(r);
    expect(ordre.indexOf("A")).toBeLessThan(ordre.indexOf("B"));
    expect(new Set(ordre)).toEqual(new Set(["A", "B", "N"]));
  });
});

describe("stratégie « proche » avec un sens habituel", () => {
  it("l'ordre habituel est un candidat de plus, retenu à coût quasi égal", () => {
    const listes = [
      { id: "E", name: "Est", position: 0 },
      { id: "O", name: "Ouest", position: 1 },
    ];
    const arrets = [arret("E", pt(10, 0)), arret("E", pt(11, 0)), arret("O", pt(-10, 0)), arret("O", pt(-11, 0))];
    const r = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, { strategie: "proche" }, { reference: ref("Ouest", "Est") });
    expect(r.listes.map((l) => l.id)).toEqual(["O", "E"]);
  });
});

describe("le sens est appliqué à la séquence complète (listes puis arrêts)", () => {
  it("les arrêts suivent l'ordre des villages retenu", () => {
    const listes = [
      { id: "E", name: "Est", position: 0 },
      { id: "O", name: "Ouest", position: 1 },
    ];
    const arrets = [arret("E", pt(10, 0)), arret("O", pt(-10, 0)), arret("E", pt(11, 0)), arret("O", pt(-11, 0))];
    const r = ordonnerListesGlobalement(arrets, listes, depot, false, distanceKm, undefined, { reference: ref("Ouest", "Est") });
    const seq = sequenceParListes(arrets, r.listes, depot, false);
    const villageDe = new Map(arrets.map((a) => [a.id, a.list_id]));
    expect(seq.sequence.map((id) => villageDe.get(id))).toEqual(["O", "O", "E", "E"]);
  });
});
