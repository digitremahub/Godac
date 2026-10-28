import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GPS_POINTAGE_JOURS, gpsPointageConserve, limiteGpsPointage, moisSansPositions } from "@/lib/retention/gps-pointage";

const maintenant = new Date("2026-10-28T12:00:00Z");

describe("position GPS de pointage : 2 mois", () => {
  it("la durée est de 60 jours", () => {
    expect(GPS_POINTAGE_JOURS).toBe(60);
  });

  it("la limite est 60 jours avant maintenant", () => {
    expect(limiteGpsPointage(maintenant)).toBe("2026-08-29T12:00:00.000Z");
  });

  it("un pointage de moins de 60 jours garde ses coordonnées, un plus ancien les perd", () => {
    expect(gpsPointageConserve("2026-10-01T08:00:00Z", maintenant)).toBe(true);
    expect(gpsPointageConserve("2026-08-29T12:00:00Z", maintenant)).toBe(true);
    expect(gpsPointageConserve("2026-08-29T11:59:59Z", maintenant)).toBe(false);
    expect(gpsPointageConserve(new Date("2026-01-05T08:00:00Z"), maintenant)).toBe(false);
  });

  it("un mois dont la fin a plus de 60 jours n'a plus de positions pour le calcul des heures", () => {
    expect(moisSansPositions("2026-08-31T23:59:59", maintenant)).toBe(false);
    expect(moisSansPositions("2026-08-28T23:59:59", maintenant)).toBe(true);
    expect(moisSansPositions("2026-09-30T23:59:59", maintenant)).toBe(false);
  });

  it("la purge nocturne efface les coordonnées (pas les heures) avec cette durée", () => {
    const purge = readFileSync("lib/retention/purge.ts", "utf8");
    expect(purge).toContain("clockGps: GPS_POINTAGE_JOURS");
    expect(purge).toContain("limiteGpsPointage()");
    // Seules les coordonnées sont mises à null : jamais l'heure d'entrée ou de sortie.
    expect(purge).toContain(".update({ clock_in_lat: null, clock_in_lng: null }");
    expect(purge).toContain(".update({ clock_out_lat: null, clock_out_lng: null }");
    expect(purge).not.toMatch(/\.update\(\{[^}]*clocked_(in|out)_at/);
  });

  it("les textes publiés annoncent 2 mois", () => {
    const conf = readFileSync("app/confidentialite/page.tsx", "utf8");
    expect(conf).toContain("Position GPS de pointage* : 2 mois");
    expect(conf).not.toMatch(/Position GPS de pointage\* : 1 an/);
    expect(readFileSync("app/dpa/page.tsx", "utf8")).toContain("Position de pointage conservée 2 mois");
    expect(readFileSync("app/cgu/page.tsx", "utf8")).toContain("conservée 2 mois pour prouver le temps de travail");
  });
});
