import { describe, expect, it } from "vitest";
import { medoide, ordonnerListesGlobalement } from "@/lib/colis/tournee-globale";
import { sequenceParListes } from "@/lib/colis/listes";
import { distanceKm, type Point } from "@/lib/colis/optimisation";
import { planifierBlocs } from "@/lib/colis/matrice";

const depot: Point = { lat: 45, lng: 5 };
const pt = (dx: number, dy: number): Point => ({ lat: 45 + dy / 111.2, lng: 5 + dx / (111.2 * Math.cos((45 * Math.PI) / 180)) });
let n = 0;
const arret = (list_id: string, p: Point, status = "pending") => ({ id: `s${n++}`, list_id, position: n, status, lat: p.lat, lng: p.lng });

describe("ordonnerListesGlobalement", () => {
  // Trois villages sur une ligne vers l'est (10, 20, 30 km), listes saisies dans le désordre.
  const listes = [
    { id: "C", name: "Village C", position: 0 },
    { id: "A", name: "Village A", position: 1 },
    { id: "B", name: "Village B", position: 2 },
    { id: "V", name: "Vide", position: 3 },
  ];
  const arrets = [
    arret("A", pt(10, 0)), arret("A", pt(11, 1)),
    arret("B", pt(20, 0)), arret("B", pt(21, -1)),
    arret("C", pt(30, 0)), arret("C", pt(31, 1)),
  ];

  it("enchaîne les villages dans un sens de tournée (A → B → C), listes vides à la fin", () => {
    const r = ordonnerListesGlobalement(arrets, listes, depot, false);
    expect(r.listes.map((l) => l.id)).toEqual(["A", "B", "C", "V"]);
    expect(r.listes.map((l) => l.position)).toEqual([0, 1, 2, 3]);
    expect(r.km).toBeLessThan(r.kmOrdreActuel);
  });

  it("chaque village part du dernier arrêt du précédent", () => {
    const r = ordonnerListesGlobalement(arrets, listes, depot, false);
    const seq = sequenceParListes(arrets, r.listes, depot, false);
    const villageDe = new Map(arrets.map((a) => [a.id, a.list_id]));
    expect(seq.sequence.map((id) => villageDe.get(id))).toEqual(["A", "A", "B", "B", "C", "C"]);
  });

  it("utilise la distance fournie (km routiers) : une route qui contourne change l'ordre", () => {
    // Pont coupé : depuis le dépôt, A coûte très cher, C est accessible directement.
    const routiere = (a: Point, b: Point) => {
      const d = distanceKm(a, b);
      const versA = (p: Point) => Math.abs(p.lng - pt(10, 0).lng) < 0.03;
      const estDepot = (p: Point) => p.lat === depot.lat && p.lng === depot.lng;
      return (estDepot(a) && versA(b)) || (estDepot(b) && versA(a)) ? d + 100 : d;
    };
    const r = ordonnerListesGlobalement(arrets, listes, depot, false, routiere);
    expect(r.listes[0]!.id).not.toBe("A");
  });

  it("une seule liste active : rien à ordonner", () => {
    const r = ordonnerListesGlobalement([arret("B", pt(1, 1))], listes, depot, true);
    expect(r.listes[0]!.id).toBe("B");
  });

  it("médoïde : l'arrêt le plus central", () => {
    expect(medoide([pt(0, 0), pt(1, 0), pt(10, 0)], distanceKm)).toEqual(pt(1, 0));
    expect(medoide([])).toBeNull();
  });
});

describe("planifierBlocs (matrice routière découpée)", () => {
  it("blocs de 45 points au plus, toutes les paires de blocs", () => {
    expect(planifierBlocs(10)).toEqual({ blocs: [[0, 10]], requetes: [[0, 0]] });
    const p = planifierBlocs(100);
    expect(p.blocs).toEqual([[0, 45], [45, 90], [90, 100]]);
    expect(p.requetes).toHaveLength(9);
  });
});
