import { describe, expect, it } from "vitest";
import { compteurs, grouperParListe, nomNouvelleListe, ordonnerParListe, sequenceParListes } from "@/lib/colis/listes";
import { optimiserOrdre, type Point } from "@/lib/colis/optimisation";

const depot: Point = { lat: 45.75, lng: 4.85 };
const arret = (id: string, position: number, lng: number | null, list_id: string | null = null, status = "pending") => ({
  id,
  position,
  list_id,
  status,
  lat: lng === null ? null : 45.75,
  lng,
});

describe("grouperParListe", () => {
  it("sans liste : un seul groupe implicite, dans l'ordre des positions", () => {
    const g = grouperParListe([arret("b", 2, 1), arret("a", 1, 1)], []);
    expect(g).toHaveLength(1);
    expect(g[0]!.liste).toBeNull();
    expect(g[0]!.arrets.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("listes dans leur ordre, arrêts sans liste (ou d'une liste inconnue) en tête", () => {
    const listes = [
      { id: "L2", name: "Deux", position: 1 },
      { id: "L1", name: "Un", position: 0 },
    ];
    const g = grouperParListe([arret("x", 0, 1, "L2"), arret("y", 1, 1, "L1"), arret("z", 2, 1, null), arret("w", 3, 1, "inconnue")], listes);
    expect(g.map((x) => x.liste?.id ?? null)).toEqual([null, "L1", "L2"]);
    expect(g[0]!.arrets.map((s) => s.id)).toEqual(["z", "w"]);
    expect(ordonnerParListe([arret("x", 0, 1, "L2"), arret("y", 1, 1, "L1")], listes).map((s) => s.id)).toEqual(["y", "x"]);
  });

  it("une liste vide reste affichée, la liste implicite vide disparaît dès qu'il y a des listes", () => {
    const g = grouperParListe([], [{ id: "L1", name: "Un", position: 0 }]);
    expect(g.map((x) => x.liste?.id)).toEqual(["L1"]);
  });
});

describe("nomNouvelleListe", () => {
  it("propose « Liste N » sans doublon", () => {
    expect(nomNouvelleListe([])).toBe("Liste 1");
    expect(nomNouvelleListe([], true)).toBe("Liste 2");
    expect(nomNouvelleListe([{ name: "Liste principale" }, { name: "Liste 3" }])).toBe("Liste 4");
  });
});

describe("sequenceParListes", () => {
  it("sans liste : même ordre que l'optimisation simple, faits en tête, non localisés à la fin", () => {
    const stops = [arret("a", 0, 4.9), arret("f", 1, 4.86, null, "delivered"), arret("b", 2, 4.87), arret("c", 3, 4.88), arret("n", 4, null)];
    const r = sequenceParListes(stops, [], depot, true);
    const pts = [stops[0]!, stops[2]!, stops[3]!];
    const attendu = optimiserOrdre(
      depot,
      pts.map((s) => ({ lat: s.lat!, lng: s.lng! })),
      true,
    ).map((i) => pts[i]!.id);
    expect(r.sequence).toEqual(["f", ...attendu, "n"]);
    expect(r.sansGps).toBe(1);
  });

  it("optimise chaque liste dans l'ordre des listes, enchaînées", () => {
    const listes = [
      { id: "L1", name: "Un", position: 0 },
      { id: "L2", name: "Deux", position: 1 },
    ];
    // Liste 1 loin à l'est, liste 2 près du dépôt : l'ordre des listes est
    // respecté, la liste 2 part du dernier arrêt de la liste 1 et revient au dépôt.
    const stops = [
      arret("p", 0, 4.86, "L2"),
      arret("q", 1, 4.87, "L2"),
      arret("r", 2, 4.88, "L2"),
      arret("e3", 3, 5.0, "L1"),
      arret("e1", 4, 4.95, "L1"),
      arret("e2", 5, 4.97, "L1"),
      arret("nl", 6, null, "L1"),
    ];
    const r = sequenceParListes(stops, listes, depot, true);
    expect(r.sequence).toEqual(["e1", "e2", "e3", "nl", "r", "q", "p"]);
    expect(new Set(r.sequence).size).toBe(stops.length);
  });

  it("le retour au dépôt ne compte qu'après la dernière liste", () => {
    const listes = [
      { id: "L1", name: "Un", position: 0 },
      { id: "L2", name: "Deux", position: 1 },
    ];
    const stops = [arret("a", 0, 4.9, "L1"), arret("b", 1, 4.95, "L2")];
    const r = sequenceParListes(stops, listes, depot, true);
    expect(r.sequence).toEqual(["a", "b"]);
    // Dépôt → a → b → dépôt, sur une ligne : 2 × (4.95 − 4.85)° de longitude.
    expect(r.kmApres).toBeCloseTo(r.kmAvant, 6);
  });
});

describe("compteurs", () => {
  it("arrêts, colis, restants", () => {
    expect(
      compteurs([
        { parcel_count: 2, status: "pending" },
        { parcel_count: 1, status: "delivered" },
      ]),
    ).toEqual({ arrets: 2, colis: 3, restants: 1 });
  });
});
