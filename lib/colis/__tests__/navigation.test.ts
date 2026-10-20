import { describe, expect, it } from "vitest";
import { arretApresCloture, arretSuivi, doitRecalculer, ecartAuTrace, formatDistance, formatDuree, meilleureInsertion, resteSurTrace, DELAI_RECALCUL_MS } from "@/lib/colis/navigation";
import { reordonner } from "@/lib/colis/reordonner";

const s = (id: string, status = "pending", extra: Record<string, unknown> = {}) => ({ id, status, ...extra });

describe("arrêt suivi et passage au suivant", () => {
  const stops = [s("a", "delivered"), s("b"), s("c"), s("d")];
  it("sans choix : le premier restant", () => expect(arretSuivi(stops, null)?.id).toBe("b"));
  it("carte choisie encore à faire : elle", () => expect(arretSuivi(stops, "c")?.id).toBe("c"));
  it("carte choisie clôturée : retombe sur le prochain", () => {
    expect(arretSuivi([s("a", "delivered"), s("b"), s("c", "failed"), s("d")], "c")?.id).toBe("b");
  });
  it("tout est fait : null", () => expect(arretSuivi([s("a", "delivered")], "a")).toBeNull());
  it("après clôture : le restant suivant dans l'ordre, sinon le premier laissé avant", () => {
    expect(arretApresCloture(stops, "c")?.id).toBe("d");
    expect(arretApresCloture(stops, "d")?.id).toBe("b");
    expect(arretApresCloture([s("x")], "x")).toBeNull();
  });
});

describe("écart au tracé et recalcul", () => {
  // Tracé est-ouest le long du parallèle 48.85.
  const ligne: [number, number][] = [[2.30, 48.85], [2.32, 48.85]];
  it("sur le tracé : écart ≈ 0 ; à ~111 m au nord : > 60 m", () => {
    expect(ecartAuTrace({ lat: 48.85, lng: 2.31 }, ligne)).toBeLessThan(1);
    const e = ecartAuTrace({ lat: 48.851, lng: 2.31 }, ligne);
    expect(e).toBeGreaterThan(100);
    expect(e).toBeLessThan(120);
    expect(ecartAuTrace({ lat: 48.85, lng: 2.31 }, [])).toBe(Infinity);
  });
  const base = { cible: "b", cibleTracee: "b", ligne, position: { lat: 48.851, lng: 2.31 }, dernierCalcul: 0, maintenant: DELAI_RECALCUL_MS + 1 };
  it("changement d'arrêt ou pas de tracé : recalcul immédiat", () => {
    expect(doitRecalculer({ ...base, cibleTracee: "a", maintenant: 1 })).toBe(true);
    expect(doitRecalculer({ ...base, ligne: null, maintenant: 1 })).toBe(true);
  });
  it("écart : recalcul, mais pas trop souvent", () => {
    expect(doitRecalculer(base)).toBe(true);
    expect(doitRecalculer({ ...base, maintenant: 1000 })).toBe(false);
    expect(doitRecalculer({ ...base, position: { lat: 48.85, lng: 2.31 } })).toBe(false);
  });
  it("distance restante le long du tracé", () => {
    const total = resteSurTrace({ lat: 48.85, lng: 2.30 }, ligne)!;
    expect(total).toBeGreaterThan(1400);
    expect(total).toBeLessThan(1500);
    const moitie = resteSurTrace({ lat: 48.85, lng: 2.31 }, [[2.30, 48.85], [2.31, 48.85], [2.32, 48.85]])!;
    expect(moitie).toBeGreaterThan(700);
    expect(moitie).toBeLessThan(750);
    expect(resteSurTrace({ lat: 48.85, lng: 2.31 }, [])).toBeNull();
  });
  it("aucun arrêt : jamais", () => expect(doitRecalculer({ ...base, cible: null })).toBe(false));
});

describe("formats", () => {
  it("distances et durées", () => {
    expect(formatDistance(4)).toBe("10 m");
    expect(formatDistance(347)).toBe("350 m");
    expect(formatDistance(2450)).toBe("2,5 km");
    expect(formatDistance(23_400)).toBe("23 km");
    expect(formatDistance(null)).toBe("—");
    expect(formatDuree(0.4)).toBe("< 1 min");
    expect(formatDuree(12)).toBe("12 min");
    expect(formatDuree(75)).toBe("1 h 15");
  });
});

describe("insertion d'une adresse ajoutée en cours de tournée", () => {
  // Arrêts alignés vers l'est (≈ 730 m entre deux longitudes 0.01 à 48.85).
  const arret = (id: string, lng: number, extra: Record<string, unknown> = {}) => ({ id, status: "pending", list_id: null, lat: 48.85, lng, ...extra });
  const stops = [arret("fait", 2.29, { status: "delivered" }), arret("a", 2.30), arret("b", 2.31), arret("c", 2.32), arret("d", 2.33)];

  it("se glisse entre les deux arrêts qui l'encadrent", () => {
    const r = meilleureInsertion(stops, arret("n", 2.315, { lat: 48.8505 }));
    expect(r?.cible).toEqual({ list_id: null, avant_id: "c" });
    expect(r?.rang).toBe(2);
  });
  it("au-delà du dernier : en fin de liste", () => {
    expect(meilleureInsertion(stops, arret("n", 2.36))?.cible).toEqual({ list_id: null, avant_id: null });
  });
  it("près du chauffeur, avant le premier restant : devient le prochain arrêt", () => {
    expect(meilleureInsertion(stops, arret("n", 2.296), { lat: 48.85, lng: 2.295 })?.cible).toEqual({ list_id: null, avant_id: "a" });
  });
  it("reste dans sa liste (village) même si un arrêt d'un autre village est plus proche", () => {
    const v = [arret("a", 2.30, { list_id: "V1" }), arret("b", 2.31, { list_id: "V1" }), arret("c", 2.32, { list_id: "V2" }), arret("d", 2.33, { list_id: "V2" })];
    const r = meilleureInsertion(v, arret("n", 2.325, { list_id: "V1" }));
    // Les places possibles : devant a, devant b, ou en fin de V1 (avant c).
    expect(r?.cible).toEqual({ list_id: "V1", avant_id: null });
    const r2 = meilleureInsertion(v, arret("n", 2.335, { list_id: "V2" }));
    expect(r2?.cible).toEqual({ list_id: "V2", avant_id: null });
    const r3 = meilleureInsertion(v, arret("n", 2.3, { list_id: "V2" }));
    expect(r3?.cible).toEqual({ list_id: "V2", avant_id: "c" });
  });
  it("le dépôt calculé s'applique avec reordonner (positions contiguës)", () => {
    const tous = [...stops.map((x, i) => ({ ...x, position: i })), { ...arret("n", 2.315), position: 5 }];
    const r = meilleureInsertion(tous, tous[5]!)!;
    const changements = reordonner(tous, "n", r.cible);
    expect(changements.find((c) => c.id === "n")?.position).toBe(3);
  });
  it("adresse non localisée : pas de placement", () => {
    expect(meilleureInsertion(stops, arret("n", 0, { lat: null, lng: null }))).toBeNull();
  });
});
