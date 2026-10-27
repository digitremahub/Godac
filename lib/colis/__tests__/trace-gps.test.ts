import { describe, expect, it } from "vitest";
import {
  MAX_FILE,
  ajouterAFile,
  arretsProlonges,
  depuisCompact,
  doitEnvoyer,
  doitEnvoyerPosition,
  dureeConduiteMin,
  garderPoint,
  kmParcourus,
  lireFile,
  pointValide,
  type PointTrace,
} from "@/lib/colis/trace-gps";

// Elne (66) : 0,001° de latitude ≈ 111 m.
const BASE = { lat: 42.6, lng: 2.97 };
const pt = (t: number, dLat = 0, dLng = 0, acc: number | null = 10): PointTrace => ({ t, lat: BASE.lat + dLat, lng: BASE.lng + dLng, acc });

describe("pointValide / garderPoint (filtrage et échantillonnage)", () => {
  it("rejette les points imprécis (> 50 m) ou hors bornes", () => {
    expect(pointValide(pt(0, 0, 0, 49))).toBe(true);
    expect(pointValide(pt(0, 0, 0, 51))).toBe(false);
    expect(pointValide({ t: 0, lat: 0, lng: 0 })).toBe(false);
    expect(pointValide({ t: 0, lat: 95, lng: 2 })).toBe(false);
    expect(pointValide(pt(0, 0, 0, null))).toBe(true);
  });
  it("garde le premier point valide", () => {
    expect(garderPoint(null, pt(0))).toBe(true);
    expect(garderPoint(null, pt(0, 0, 0, 80))).toBe(false);
  });
  it("garde un point à plus de 20 m du précédent, pas en dessous", () => {
    expect(garderPoint(pt(0), pt(5_000, 0.0003))).toBe(true); // ≈ 33 m
    expect(garderPoint(pt(0), pt(5_000, 0.0001))).toBe(false); // ≈ 11 m
  });
  it("au plus un point toutes les 3 s en roulant", () => {
    expect(garderPoint(pt(0), pt(1_000, 0.001))).toBe(false);
    expect(garderPoint(pt(0), pt(3_000, 0.001))).toBe(true);
  });
  it("à l'arrêt : un point toutes les 30 s", () => {
    expect(garderPoint(pt(0), pt(29_000))).toBe(false);
    expect(garderPoint(pt(0), pt(30_000))).toBe(true);
  });
  it("ignore un point plus ancien que le précédent", () => {
    expect(garderPoint(pt(10_000), pt(5_000, 0.01))).toBe(false);
  });
});

describe("file locale et envoi par lots", () => {
  it("plafonne la file en perdant les plus anciens", () => {
    let f: PointTrace[] = [];
    for (let i = 0; i < 5; i++) f = ajouterAFile(f, pt(i * 1000), 3);
    expect(f.map((p) => p.t)).toEqual([2000, 3000, 4000]);
    expect(MAX_FILE).toBeGreaterThanOrEqual(1000);
  });
  it("envoie dès 10 points ou après 30 s", () => {
    expect(doitEnvoyer(0, 0, 60_000)).toBe(false);
    expect(doitEnvoyer(10, 50_000, 51_000)).toBe(true);
    expect(doitEnvoyer(3, 50_000, 60_000)).toBe(false);
    expect(doitEnvoyer(3, 50_000, 70_000)).toBe(false);
    expect(doitEnvoyer(3, 50_000, 80_000)).toBe(true);
  });
  it("envoie la position seule après 60 s quand aucun point n'est gardé", () => {
    expect(doitEnvoyerPosition(true, 0, 0, 59_000)).toBe(false);
    expect(doitEnvoyerPosition(true, 0, 0, 60_000)).toBe(true);
    expect(doitEnvoyerPosition(false, 0, 0, 120_000)).toBe(false);
    expect(doitEnvoyerPosition(true, 2, 0, 120_000)).toBe(false);
  });
  it("relit la file stockée en écartant les points invalides", () => {
    const brut = JSON.stringify([pt(2000), { t: 1, lat: "x" }, pt(1000), pt(3000, 0, 0, 120)]);
    expect(lireFile(brut).map((p) => p.t)).toEqual([1000, 2000]);
    expect(lireFile("pas du json")).toEqual([]);
    expect(lireFile(null)).toEqual([]);
  });
  it("lit le format compact de l'API", () => {
    expect(depuisCompact([[2.97, 42.6, 1000]])).toEqual([{ lng: 2.97, lat: 42.6, t: 1000 }]);
  });
});

describe("km réels et durée de conduite", () => {
  it("additionne les segments", () => {
    // 10 segments de ≈ 111 m, un toutes les 10 s (≈ 40 km/h).
    const pts = Array.from({ length: 11 }, (_, i) => pt(i * 10_000, i * 0.001));
    expect(kmParcourus(pts)).toBeCloseTo(1.112, 2);
    expect(dureeConduiteMin(pts)).toBeCloseTo(100 / 60, 3);
  });
  it("ignore les sauts aberrants du GPS (> 200 km/h)", () => {
    const pts = [pt(0), pt(10_000, 0.001), pt(11_000, 0.05), pt(20_000, 0.002)];
    // Le saut de 5 km en 1 s et le retour sont écartés.
    expect(kmParcourus(pts)).toBeCloseTo(0.111, 2);
  });
  it("ne compte pas l'immobilisation ni les trous de plus de 5 min dans la conduite", () => {
    const pts = [pt(0), pt(60_000), pt(120_000), pt(720_000, 0.01)];
    expect(dureeConduiteMin(pts)).toBe(0);
    expect(kmParcourus([])).toBe(0);
  });
});

describe("arrêts prolongés", () => {
  const immobile = (debut: number, minutes: number, dLat = 0) => Array.from({ length: minutes * 2 + 1 }, (_, i) => pt(debut + i * 30_000, dLat + (i % 2 ? 0.00005 : 0)));
  it("signale une immobilisation de plus de 5 min hors arrêt de livraison", () => {
    const pts = [...immobile(0, 8), pt(8 * 60_000 + 60_000, 0.01)];
    const a = arretsProlonges(pts, []);
    expect(a).toHaveLength(1);
    expect(a[0]!.dureeMin).toBe(8);
  });
  it("ignore une immobilisation courte", () => {
    expect(arretsProlonges(immobile(0, 4), [])).toHaveLength(0);
  });
  it("ignore une immobilisation à un arrêt de livraison", () => {
    expect(arretsProlonges(immobile(0, 10), [{ lat: BASE.lat + 0.0003, lng: BASE.lng }])).toHaveLength(0);
  });
  it("trouve plusieurs immobilisations séparées par un trajet", () => {
    const pts = [...immobile(0, 6), ...Array.from({ length: 5 }, (_, i) => pt(13 * 60_000 + i * 10_000, 0.001 * (i + 1))), ...immobile(20 * 60_000, 7, 0.01)];
    const a = arretsProlonges(pts, []);
    expect(a.map((x) => x.dureeMin)).toEqual([6, 7]);
  });
});
