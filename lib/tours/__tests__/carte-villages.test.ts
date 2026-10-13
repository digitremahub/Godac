import { describe, expect, it } from "vitest";
import {
  OUTLIER_MAX_KM,
  OUTLIER_MIN_KM,
  OUTLIER_RATIO,
  TOUR_PALETTE,
  analyzeVillages,
  assignTourColors,
  convexHull,
  findDuplicates,
  findOutliers,
  haversineKm,
  isOutlierDistance,
  medianCenter,
  normalizeVillageName,
  type LngLat,
  type MapVillage,
} from "@/lib/tours/carte-villages";

let seq = 0;
function v(routeId: string, name: string, coords: LngLat | null, extra: Partial<MapVillage> = {}): MapVillage {
  return {
    id: `v${++seq}`,
    routeId,
    tourNumber: routeId.toUpperCase(),
    serviceId: "s1",
    serviceName: "Service 1",
    name,
    postalCode: null,
    lng: coords ? coords[0] : null,
    lat: coords ? coords[1] : null,
    inseeCode: null,
    geoStatus: coords ? "ok" : null,
    ...extra,
  };
}

describe("couleurs des tournées", () => {
  it("stables, distinctes, triées en ordre naturel", () => {
    const c = assignTourColors(["T10", "T2", "T1", "T2"]);
    expect(c.size).toBe(3);
    expect(c.get("T1")).toBe(TOUR_PALETTE[0]);
    expect(c.get("T2")).toBe(TOUR_PALETTE[1]);
    expect(c.get("T10")).toBe(TOUR_PALETTE[2]);
    // Ne dépend pas de l'ordre d'entrée.
    expect(assignTourColors(["T1", "T10", "T2"])).toEqual(c);
  });
  it("au-delà de la palette, toujours des couleurs toutes différentes", () => {
    const keys = Array.from({ length: 40 }, (_, i) => `T${i}`);
    const c = assignTourColors(keys);
    expect(new Set(c.values()).size).toBe(40);
  });
});

describe("enveloppe convexe", () => {
  it("garde les sommets d'un carré et écarte l'intérieur", () => {
    const hull = convexHull([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
      [0.2, 0.7],
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).toEqual(
      expect.arrayContaining([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    );
  });
  it("points alignés ou en double", () => {
    expect(
      convexHull([
        [0, 0],
        [1, 1],
        [2, 2],
      ]),
    ).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(
      convexHull([
        [3, 4],
        [3, 4],
      ]),
    ).toEqual([[3, 4]]);
    expect(convexHull([])).toEqual([]);
  });
});

describe("distances", () => {
  it("haversine Paris – Lyon ≈ 392 km", () => {
    const d = haversineKm([2.3522, 48.8566], [4.8357, 45.764]);
    expect(d).toBeGreaterThan(385);
    expect(d).toBeLessThan(400);
  });
  it("centre médian insensible à un point aberrant", () => {
    const [lng, lat] = medianCenter([
      [0, 0],
      [0.1, 0.1],
      [0.2, 0.2],
      [50, 50],
    ]);
    expect(lng).toBeCloseTo(0.15);
    expect(lat).toBeCloseTo(0.15);
  });
});

describe("seuils de village isolé", () => {
  it("ratio de la distance médiane", () => {
    expect(isOutlierDistance(OUTLIER_RATIO * 4 + 0.1, 4)).toBe(true);
    expect(isOutlierDistance(OUTLIER_RATIO * 4 - 0.1, 4)).toBe(false);
  });
  it("maximum absolu même si la tournée est étendue", () => {
    expect(isOutlierDistance(OUTLIER_MAX_KM + 1, 20)).toBe(true);
    expect(isOutlierDistance(OUTLIER_MAX_KM - 1, 20)).toBe(false);
  });
  it("pas d'alerte sous le minimum (tournée très groupée)", () => {
    expect(isOutlierDistance(OUTLIER_MIN_KM - 0.5, 0.5)).toBe(false);
  });
});

describe("villages isolés", () => {
  // ~1 km ≈ 0,009° de latitude
  const tour = [v("t1", "A", [5.0, 45.0]), v("t1", "B", [5.02, 45.01]), v("t1", "C", [5.01, 45.03]), v("t1", "D", [4.99, 45.02])];
  it("signale le village à 40 km du reste", () => {
    const loin = v("t1", "Loin", [5.0, 45.36]);
    const issues = findOutliers([...tour, loin]);
    expect(issues.map((i) => i.village.name)).toEqual(["Loin"]);
    expect(issues[0]!.distanceKm).toBeGreaterThan(35);
  });
  it("rien à signaler pour une tournée groupée", () => {
    expect(findOutliers(tour)).toEqual([]);
  });
  it("ignore les tournées de moins de 3 villages localisés", () => {
    expect(findOutliers([v("t2", "X", [5, 45]), v("t2", "Y", [6, 46]), v("t2", "Z", null)])).toEqual([]);
  });
});

describe("villages sur plusieurs tournées", () => {
  it("même nom (accents, St/Saint) sur deux tournées du même service", () => {
    const d = findDuplicates([v("t1", "Saint-Étienne-de-Crossey", null), v("t2", "St Etienne de Crossey", null), v("t2", "Autre", null)]);
    expect(d).toHaveLength(1);
    expect(d[0]!.tourNumbers).toEqual(["T1", "T2"]);
    expect(d[0]!.sameService).toBe(true);
  });
  it("même code INSEE entre services différents", () => {
    const d = findDuplicates([
      v("t1", "Voiron", [5.59, 45.36], { inseeCode: "38563" }),
      v("t3", "VOIRON", [5.59, 45.36], { inseeCode: "38563", serviceId: "s2" }),
    ]);
    expect(d).toHaveLength(1);
    expect(d[0]!.sameService).toBe(false);
  });
  it("pas de doublon pour deux homonymes de départements différents", () => {
    expect(
      findDuplicates([v("t1", "Saint-Martin", [1, 45], { inseeCode: "11111" }), v("t2", "Saint-Martin", [3, 47], { inseeCode: "22222" })]),
    ).toEqual([]);
  });
  it("un village répété dans la même tournée n'est pas un doublon entre tournées", () => {
    expect(findDuplicates([v("t1", "A", null), v("t1", "A", null)])).toEqual([]);
  });
});

describe("analyse complète", () => {
  it("non localisés et étendue", () => {
    const a = analyzeVillages([v("t1", "A", [5, 45]), v("t1", "B", [5.1, 45]), v("t1", "C", [5, 45.1]), v("t1", "D", null, { geoStatus: "introuvable" })]);
    expect(a.unlocated.map((x) => x.name)).toEqual(["D"]);
    const e = a.extents.get("t1")!;
    expect(e.hull).toHaveLength(3);
    expect(e.spanKm).toBeGreaterThan(10);
  });
  it("normalisation des noms", () => {
    expect(normalizeVillageName("  Sainte-Foy-l'Argentière ")).toBe("sainte foy l argentiere");
    expect(normalizeVillageName("Ste Foy l’Argentière")).toBe("sainte foy l argentiere");
  });
});
