import { describe, expect, it } from "vitest";
import { longueurChemin, optimiserOrdre, plusProcheVoisin, type Point } from "@/lib/colis/optimisation";
import { sequenceParListes, type ArretOptimisable, type Liste } from "@/lib/colis/listes";
import { ordonnerListesGlobalement } from "@/lib/colis/tournee-globale";
import { contraintesListes, epingler, epingleDe, lireArrivee, lireDepart, pointFinTournee, resoudreExtremites, type ArretExtremite } from "@/lib/colis/extremites";

const depot: Point = { lat: 45.75, lng: 4.85 };
// Arrêts alignés d'ouest en est : a (le plus proche du dépôt) … e.
const ligne = (ks: number[]): Point[] => ks.map((k) => ({ lat: 45.75, lng: 4.85 + k * 0.01 }));
const arret = (id: string, k: number, extra: Partial<ArretOptimisable> = {}): ArretOptimisable => ({ id, position: k, status: "pending", lat: 45.75, lng: 4.85 + k * 0.01, list_id: null, ...extra });
const ids = (r: { sequence: string[] }) => r.sequence;
const km = (a: Point, b: Point) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 78);

describe("optimiserOrdre : extrémités fixes", () => {
  it("départ au dépôt, arrivée à un autre point : suit la ligne du départ vers l'arrivée", () => {
    const pts = ligne([4, 2, 5, 1, 3]);
    const arrivee = ligne([8])[0]!;
    const ordre = optimiserOrdre(depot, pts, false, arrivee, km);
    expect(ordre.map((i) => pts[i]!.lng)).toEqual([...pts.map((p) => p.lng)].sort((a, b) => a - b));
  });

  it("arrivée du côté du départ : l'ordre revient vers l'arrivée", () => {
    const pts = ligne([3, 1, 4, 2]);
    const arrivee = ligne([-1])[0]!; // derrière le dépôt
    const ordre = optimiserOrdre(depot, pts, false, arrivee, km);
    const chemin = ordre.map((i) => pts[i]!);
    const optimal = Math.min(...permutations(pts).map((p) => longueurChemin(depot, p, arrivee, km)));
    expect(longueurChemin(depot, chemin, arrivee, km)).toBeCloseTo(optimal, 6);
  });

  it("retour au dépôt : trouve l'optimum sur un petit cas (comparaison exhaustive)", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let t = 0; t < 8; t++) {
      const pts = Array.from({ length: 6 }, () => ({ lat: 45.6 + rnd() * 0.2, lng: 4.7 + rnd() * 0.3 }));
      const ordre = optimiserOrdre(depot, pts, true, null, km);
      const trouve = longueurChemin(depot, ordre.map((i) => pts[i]!), depot, km);
      const optimal = Math.min(...permutations(pts).map((p) => longueurChemin(depot, p, depot, km)));
      expect(trouve).toBeLessThanOrEqual(optimal * 1.05);
    }
  });
});

function permutations<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a];
  return a.flatMap((x, i) => permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
}

describe("sequenceParListes : premier et dernier arrêt", () => {
  const arrets = [arret("a", 3), arret("b", 1), arret("c", 5), arret("d", 2), arret("e", 4)];

  it("départ = dépôt, arrivée = dépôt : boucle, le retour compte dans la distance", () => {
    const r = sequenceParListes(arrets, [], depot, true, undefined, km, { fin: depot });
    expect(ids(r)).toHaveLength(5);
    // Aller jusqu'à l'arrêt le plus lointain (k = 5) puis revenir : 2 × 0,05° de longitude.
    expect(r.kmApres).toBeCloseTo(2 * km(depot, { lat: 45.75, lng: 4.9 }), 3);
    expect(r.kmApres).toBeGreaterThan(longueurChemin(depot, ligne([1, 2, 3, 4, 5]), null, km));
  });

  it("départ = arrêt X, arrivée = arrêt Y : X premier, Y dernier, le reste optimisé entre les deux", () => {
    const x = arrets.find((s) => s.id === "d")!; // k = 2
    const y = arrets.find((s) => s.id === "b")!; // k = 1
    const xp = { lat: Number(x.lat), lng: Number(x.lng) };
    const yp = { lat: Number(y.lat), lng: Number(y.lng) };
    const r = sequenceParListes(arrets, [], xp, false, undefined, km, { premierId: "d", dernierId: "b", fin: yp });
    expect(ids(r)[0]).toBe("d");
    expect(ids(r)[4]).toBe("b");
    // Entre les deux : de k=2 vers k=5 puis retour sur k=1, soit a (3), e (4), c (5).
    expect(ids(r).slice(1, 4)).toEqual(["a", "e", "c"]);
    expect(ids(r).slice().sort()).toEqual(["a", "b", "c", "d", "e"]);
    // Aucun trajet avant X ni après Y.
    expect(r.kmApres).toBeCloseTo(km(xp, ligne([5])[0]!) + km(ligne([5])[0]!, yp), 3);
  });

  it("sans arrivée imposée : le chemin finit où il veut", () => {
    const r = sequenceParListes(arrets, [], depot, false, undefined, km, { fin: null });
    expect(ids(r)).toEqual(["b", "d", "a", "e", "c"]);
    expect(r.kmApres).toBeCloseTo(km(depot, ligne([5])[0]!), 3);
  });

  it("arrêt dernier avec départ au dépôt : le dernier est servi en dernier même s'il est proche", () => {
    const y = ligne([1])[0]!;
    const r = sequenceParListes(arrets, [], depot, false, undefined, km, { dernierId: "b", fin: y });
    expect(ids(r)[4]).toBe("b");
    expect(ids(r).slice(0, 4)).toEqual(["d", "a", "e", "c"]);
  });

  it("les arrêts déjà traités ne bougent pas et restent en tête", () => {
    const avecFaits = [arret("f1", 9, { status: "delivered", position: 0 }), arret("f2", 8, { status: "failed", position: 1 }), ...arrets.map((s) => ({ ...s, position: s.position + 2 }))];
    const y = ligne([1])[0]!;
    const r = sequenceParListes(avecFaits, [], depot, false, undefined, km, { dernierId: "b", premierId: "c", fin: y });
    expect(ids(r).slice(0, 2)).toEqual(["f1", "f2"]);
    expect(ids(r)[2]).toBe("c");
    expect(ids(r)[6]).toBe("b");
  });

  it("un seul arrêt restant", () => {
    const r = sequenceParListes([arret("a", 1)], [], depot, true, undefined, km, { premierId: "a", dernierId: "a", fin: depot });
    expect(ids(r)).toEqual(["a"]);
  });

  it("créneaux respectés : un arrêt qui ferme tôt passe avant, malgré la distance", () => {
    // k = 5 ferme à 8 h 08 : il doit être servi en premier, avant les arrêts proches sans contrainte.
    const f = (id: string) => (id === "c" ? ([[8 * 60, 8 * 60 + 8]] as [number, number][]) : null);
    const r = sequenceParListes(arrets, [], depot, false, { debut: 8 * 60, fenetres: f, distance: km }, undefined, { fin: null });
    expect(r.horsHoraires).toEqual([]);
    expect(r.passages["c"]!.statut).toBe("ok");
    expect(ids(r)[0]).toBe("c");
  });

  it("créneaux respectés avec un dernier arrêt imposé", () => {
    const f = (id: string) => (id === "c" ? ([[8 * 60, 8 * 60 + 8]] as [number, number][]) : null);
    const y = ligne([1])[0]!;
    const r = sequenceParListes(arrets, [], depot, false, { debut: 8 * 60, fenetres: f, distance: km }, undefined, { dernierId: "b", fin: y });
    expect(ids(r)[4]).toBe("b");
    expect(ids(r)[0]).toBe("c");
    expect(r.passages["c"]!.statut).toBe("ok");
    expect(r.fin).not.toBeNull();
  });

  it("le retour au dépôt allonge l'heure de fin estimée", () => {
    const horaires = { debut: 8 * 60, fenetres: () => null, distance: km };
    const sans = sequenceParListes(arrets, [], depot, false, horaires, undefined, { fin: null });
    const avec = sequenceParListes(arrets, [], depot, false, horaires, undefined, { fin: depot });
    expect(avec.fin! - sans.fin!).toBeGreaterThan(5);
  });

  it("sans extrémités, le comportement historique est inchangé", () => {
    const a = sequenceParListes(arrets, [], depot, true, undefined, km);
    const b = sequenceParListes(arrets, [], depot, true, undefined, km, { fin: depot });
    expect(ids(a)).toEqual(ids(b));
    expect(a.kmApres).toBeCloseTo(b.kmApres, 6);
  });
});

describe("plusieurs listes", () => {
  const listes: Liste[] = [
    { id: "L1", name: "Nord", position: 0 },
    { id: "L2", name: "Centre", position: 1 },
    { id: "L3", name: "Sud", position: 2 },
  ];
  const arrets = [arret("n", 1, { list_id: "L1" }), arret("c", 4, { list_id: "L2" }), arret("s", 2, { list_id: "L3" })];
  const resteAArreter = arrets as unknown as ArretExtremite[];

  it("la liste du dernier arrêt passe en dernier, celle du premier en premier", () => {
    const c = contraintesListes(resteAArreter.map((a) => ({ ...a, address: a.id })), listes, "s", "n");
    expect(c).toEqual({ premiereListe: "L3", derniereListe: "L1" });
    const r = ordonnerListesGlobalement(arrets, listes, depot, false, km, { premierId: "s", dernierId: "n", fin: null });
    expect(r.listes.map((l) => l.id)).toEqual(["L3", "L2", "L1"]);
  });

  it("premier et dernier dans la même liste alors que d'autres listes existent : refus clair", () => {
    const deux = [arret("x", 1, { list_id: "L1" }), arret("y", 2, { list_id: "L1" }), arret("z", 3, { list_id: "L2" })].map((a) => ({ ...a, address: a.id })) as unknown as ArretExtremite[];
    const c = contraintesListes(deux, listes, "x", "y");
    expect(c.erreur).toMatch(/même liste/);
  });

  it("la liste principale reste en tête : elle ne peut pas être la dernière", () => {
    const m = [arret("p", 1, { list_id: null }), arret("q", 2, { list_id: "L1" })].map((a) => ({ ...a, address: a.id })) as unknown as ArretExtremite[];
    expect(contraintesListes(m, listes, null, "p").erreur).toMatch(/principale/);
    expect(contraintesListes(m, listes, "q", null).erreur).toMatch(/principale/);
    expect(contraintesListes(m, listes, "p", "q").erreur).toBeUndefined();
  });
});

describe("resoudreExtremites", () => {
  const arrets: ArretExtremite[] = [
    { id: "a", status: "pending", lat: 45.76, lng: 4.86, address: "1 rue A" },
    { id: "b", status: "pending", lat: 45.77, lng: 4.87, address: "2 rue B" },
    { id: "f", status: "delivered", lat: 45.78, lng: 4.88, address: "3 rue F" },
    { id: "g", status: "pending", lat: null, lng: null, address: "4 rue G" },
  ];
  const base = { depot, position: null, arrets, retourParDefaut: true };

  it("rien de choisi : dépôt au départ et retour comme avant", () => {
    const r = resoudreExtremites({ ...base, depart: null, arrivee: null });
    expect(r).toMatchObject({ depart: depot, fin: depot, premierId: null, dernierId: null, departLibelle: "Dépôt" });
    expect(resoudreExtremites({ ...base, depart: null, arrivee: null, retourParDefaut: false }).fin).toBeNull();
    expect(resoudreExtremites({ ...base, depart: null, arrivee: null, position: { lat: 1, lng: 1 } })).toMatchObject({ depart: { lat: 1, lng: 1 }, fin: null });
  });

  it("départ dépôt, arrivée dépôt", () => {
    const r = resoudreExtremites({ ...base, depart: { mode: "depot" }, arrivee: { mode: "depot" } });
    expect(r).toMatchObject({ depart: depot, fin: depot, arriveeLibelle: "Dépôt" });
  });

  it("départ arrêt, arrivée arrêt", () => {
    const r = resoudreExtremites({ ...base, depart: { mode: "arret", arret_id: "a" }, arrivee: { mode: "arret", arret_id: "b" } });
    expect(r).toMatchObject({ premierId: "a", dernierId: "b", depart: { lat: 45.76, lng: 4.86 }, fin: { lat: 45.77, lng: 4.87 } });
  });

  it("même point que le départ, adresse libre, pas de retour", () => {
    expect(resoudreExtremites({ ...base, depart: { mode: "adresse", label: "Chez moi", lat: 45.7, lng: 4.8 }, arrivee: { mode: "meme" } })).toMatchObject({ depart: { lat: 45.7, lng: 4.8 }, fin: { lat: 45.7, lng: 4.8 } });
    expect(resoudreExtremites({ ...base, depart: { mode: "depot" }, arrivee: { mode: "libre" } }).fin).toBeNull();
    expect(resoudreExtremites({ ...base, depart: { mode: "depot" }, arrivee: { mode: "adresse", label: "Garage", lat: 45.1, lng: 4.1 } }).fin).toEqual({ lat: 45.1, lng: 4.1 });
  });

  it("en cours de route, la position du chauffeur prime ; un premier arrêt reste premier", () => {
    const pos = { lat: 45.7, lng: 4.8 };
    expect(resoudreExtremites({ ...base, position: pos, depart: { mode: "depot" }, arrivee: { mode: "depot" } })).toMatchObject({ depart: pos, fin: depot });
    expect(resoudreExtremites({ ...base, position: pos, depart: { mode: "arret", arret_id: "a" }, arrivee: null })).toMatchObject({ depart: pos, premierId: "a" });
  });

  it("refus clairs", () => {
    expect(resoudreExtremites({ ...base, depart: { mode: "arret", arret_id: "a" }, arrivee: { mode: "arret", arret_id: "a" } }).erreur).toMatch(/à la fois le premier et le dernier/);
    expect(resoudreExtremites({ ...base, depart: { mode: "arret", arret_id: "f" }, arrivee: null }).erreur).toMatch(/déjà traité/);
    expect(resoudreExtremites({ ...base, depart: null, arrivee: { mode: "arret", arret_id: "g" } }).erreur).toMatch(/pas de position GPS/);
    expect(resoudreExtremites({ ...base, depart: { mode: "arret", arret_id: "zz" }, arrivee: null }).erreur).toMatch(/n'existe plus/);
    expect(resoudreExtremites({ ...base, depot: null, depart: { mode: "depot" }, arrivee: null }).erreur).toMatch(/dépôt/);
  });

  it("« Ma position » sans GPS : on part du dépôt au lieu de bloquer", () => {
    expect(resoudreExtremites({ ...base, depart: { mode: "position" }, arrivee: null })).toMatchObject({ depart: depot });
    expect(resoudreExtremites({ ...base, position: { lat: 1, lng: 2 }, depart: { mode: "position" }, arrivee: null }).depart).toEqual({ lat: 1, lng: 2 });
  });

  it("un arrêt seul peut être premier et dernier", () => {
    const seul = [arrets[0]!];
    expect(resoudreExtremites({ ...base, arrets: seul, depart: { mode: "arret", arret_id: "a" }, arrivee: { mode: "arret", arret_id: "a" } }).erreur).toBeUndefined();
  });
});

describe("épingles et lecture", () => {
  it("un seul premier et un seul dernier ; retrait possible", () => {
    let e = epingler(null, null, "a", "premier", true);
    e = epingler(e.depart, e.arrivee, "b", "dernier", true);
    expect(epingleDe(e.depart, e.arrivee, "a")).toBe("premier");
    expect(epingleDe(e.depart, e.arrivee, "b")).toBe("dernier");
    // Un autre arrêt devient premier : a perd son épingle.
    e = epingler(e.depart, e.arrivee, "c", "premier", true);
    expect(epingleDe(e.depart, e.arrivee, "a")).toBeNull();
    expect(epingleDe(e.depart, e.arrivee, "c")).toBe("premier");
    // b passe premier : il quitte la fin.
    e = epingler(e.depart, e.arrivee, "b", "premier", true);
    expect(e.arrivee).toEqual({ mode: "depot" });
    // Retrait.
    e = epingler(e.depart, e.arrivee, "b", null, true);
    expect(e.depart).toEqual({ mode: "depot" });
    expect(epingler(null, { mode: "arret", arret_id: "z" }, "z", null, false).arrivee).toEqual({ mode: "libre" });
  });

  it("lecture tolérante des valeurs stockées", () => {
    expect(lireDepart({ mode: "depot" })).toEqual({ mode: "depot" });
    expect(lireDepart({ mode: "inconnu" })).toBeNull();
    expect(lireDepart(null)).toBeNull();
    expect(lireArrivee({ mode: "libre" })).toEqual({ mode: "libre" });
    expect(lireArrivee({ mode: "arret", arret_id: "pas-un-uuid" })).toBeNull();
  });

  it("point de fin pour l'estimation", () => {
    const arrets: ArretExtremite[] = [{ id: "a", status: "pending", lat: 45.7, lng: 4.8, address: "x" }];
    expect(pointFinTournee(null, null, depot, arrets, true)).toEqual(depot);
    expect(pointFinTournee(null, null, depot, arrets, false)).toBeNull();
    expect(pointFinTournee({ mode: "libre" }, null, depot, arrets, true)).toBeNull();
    expect(pointFinTournee({ mode: "meme" }, { mode: "arret", arret_id: "a" }, depot, arrets, true)).toEqual({ lat: 45.7, lng: 4.8 });
  });
});

describe("recalcul depuis la position : prochaine adresse la plus proche", () => {
  const arrets = [arret("a", 3), arret("b", 1), arret("c", 5), arret("d", 2), arret("e", 4)];
  const moi = ligne([2.6])[0]!; // entre d (2) et a (3), plus près de a

  it("plusProcheVoisin enchaîne toujours l'arrêt le plus proche", () => {
    const pts = ligne([3, 1, 5, 2, 4]);
    const ordre = plusProcheVoisin(moi, pts, km).map((i) => pts[i]!.lng);
    // Depuis 2,6 : 3, puis 2, puis 1, puis 4, puis 5 (jamais le plus lointain d'abord).
    expect(ordre.map((l) => Math.round((l - 4.85) * 100))).toEqual([3, 2, 1, 4, 5]);
  });

  it("deux arrêts restants : le plus proche de la position passe en premier", () => {
    const deux = ligne([1, 6]);
    const loin = ligne([8])[0]!;
    expect(optimiserOrdre(loin, deux, false, null, km)).toEqual([1, 0]);
    expect(optimiserOrdre(depot, deux, false, null, km)).toEqual([0, 1]);
  });

  it("recalcul depuis la position : arrêts livrés intacts, premier = le plus proche, dernier imposé respecté", () => {
    const avecFaits = [arret("f1", 9, { status: "delivered", position: 0 }), ...arrets.map((s) => ({ ...s, position: s.position + 1 }))];
    const r = sequenceParListes(avecFaits, [], moi, false, undefined, km, { strategie: "proche", fin: null });
    expect(ids(r)[0]).toBe("f1");
    expect(ids(r).slice(1)).toEqual(["a", "d", "b", "e", "c"]);
    expect(ids(r)[1]).toBe("a");
    const avecDernier = sequenceParListes(avecFaits, [], moi, false, undefined, km, { strategie: "proche", dernierId: "a", fin: ligne([3])[0]! });
    expect(ids(avecDernier).at(-1)).toBe("a");
    expect(ids(avecDernier)[1]).toBe("d");
  });

  it("recalcul avec horaires : un créneau serré passe d'abord, le reste suit le plus proche", () => {
    const f = (id: string) => (id === "c" ? ([[8 * 60, 8 * 60 + 8]] as [number, number][]) : null);
    const r = sequenceParListes(arrets, [], depot, false, { debut: 8 * 60, fenetres: f, distance: km, strategie: "proche" }, undefined, { fin: null });
    expect(ids(r)[0]).toBe("c");
    expect(r.horsHoraires).toEqual([]);
  });
});
