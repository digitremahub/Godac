import { describe, expect, it } from "vitest";
import { REGLES_FRANCE, reglesTempsTravail } from "@/lib/pays/temps-travail";
import { SEUIL_PAUSE_HEURES } from "@/lib/paie/heures";
import { controlerTempsTravail, joursDepuisPointages, type JourTravaille } from "@/lib/time-clock/repos";

const jour = (j: string, d: string, f: string, h: number): JourTravaille => ({ jour: j, debut: `${j}T${d}:00Z`, fin: `${f.length === 5 ? j : f}T${f.length === 5 ? f : "00:00"}:00Z`, heures: h });

describe("règles par pays", () => {
  it("France : 11 h, 13 h, 48 h, 6 jours, pause après 6 h (même seuil que les heures de paie)", () => {
    expect(REGLES_FRANCE).toMatchObject({ reposQuotidienMinHeures: 11, amplitudeMaxHeures: 13, dureeHebdoMaxHeures: 48, joursConsecutifsMax: 6 });
    expect(REGLES_FRANCE.pauseApresHeures).toBe(SEUIL_PAUSE_HEURES);
  });
  it("pays non couverts : aucun contrôle", () => {
    expect(reglesTempsTravail("MA")).toBeNull();
    expect(reglesTempsTravail("FR")).toBe(REGLES_FRANCE);
  });
});

describe("controlerTempsTravail", () => {
  it("repos quotidien < 11 h", () => {
    const r = controlerTempsTravail([jour("2026-10-26", "08:00", "20:00", 11), jour("2026-10-27", "06:00", "14:00", 8)], REGLES_FRANCE);
    expect(r.map((a) => a.code)).toContain("repos_quotidien");
  });
  it("repos de 11 h pile : pas d'avertissement", () => {
    expect(controlerTempsTravail([jour("2026-10-26", "08:00", "19:00", 10), jour("2026-10-27", "06:00", "14:00", 8)], REGLES_FRANCE)).toEqual([]);
  });
  it("amplitude > 13 h", () => {
    expect(controlerTempsTravail([jour("2026-10-26", "05:00", "19:00", 9)], REGLES_FRANCE).map((a) => a.code)).toEqual(["amplitude"]);
  });
  it("durée hebdomadaire > 48 h (lundi au dimanche)", () => {
    const j = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((d) => jour(d, "07:00", "17:00", 10));
    j.push(jour("2026-10-31", "07:00", "10:00", 3));
    expect(controlerTempsTravail(j, REGLES_FRANCE).filter((a) => a.code === "duree_hebdo")).toHaveLength(1);
  });
  it("7 jours consécutifs", () => {
    const j = Array.from({ length: 7 }, (_, i) => jour(`2026-10-${String(19 + i).padStart(2, "0")}`, "08:00", "12:00", 4));
    expect(controlerTempsTravail(j, REGLES_FRANCE).map((a) => a.code)).toContain("jours_consecutifs");
    expect(controlerTempsTravail(j.slice(0, 6), REGLES_FRANCE).map((a) => a.code)).not.toContain("jours_consecutifs");
  });
  it("joursDepuisPointages ignore l'entrée ouverte et somme les sessions", () => {
    const j = joursDepuisPointages([
      { entree: "2026-10-26T06:00:00Z", sortie: "2026-10-26T10:00:00Z" },
      { entree: "2026-10-26T11:00:00Z", sortie: "2026-10-26T15:00:00Z" },
      { entree: "2026-10-27T06:00:00Z", sortie: null },
    ]);
    expect(j).toHaveLength(1);
    expect(j[0]).toMatchObject({ jour: "2026-10-26", heures: 8 });
  });
});
