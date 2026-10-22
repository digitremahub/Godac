import { describe, expect, it } from "vitest";
import { cleSemaine, destinatairesPublication, lundiDe, messagePublication, periodePublication, textePublication, type AffectationPubliee, type ChangementAPublier } from "@/lib/planning/publication";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const LUNDI = "2026-10-19";

function aff(p: Partial<AffectationPubliee>): AffectationPubliee {
  return { driver_id: "d1", service_id: "s1", tour_number: "T101", start_at: at(LUNDI, "06:30"), status: "planned", vehicles: { registration: "AB-123-CD" }, ...p };
}
function chg(p: Partial<ChangementAPublier> & { id: string }): ChangementAPublier {
  return { driver_id: "d1", service_id: "s1", tour_number: "T101", start_at: at(LUNDI, "06:30"), nature: "ajout", ...p };
}

describe("période", () => {
  it("semaines entières", () => {
    expect(lundiDe("2026-10-23")).toBe(LUNDI);
    expect(periodePublication("2026-10-23", "2026-10-23")).toEqual({ debut: LUNDI, fin: "2026-10-25", lundis: [LUNDI] });
    expect(periodePublication("2026-10-01", "2026-10-31").lundis).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });
});

describe("destinataires", () => {
  const affectations = [
    aff({}),
    aff({ start_at: at("2026-10-20", "06:30") }),
    aff({ driver_id: "d2", tour_number: "T102" }),
    aff({ driver_id: null, tour_number: "T103" }),
    aff({ driver_id: "d3", status: "in_progress" }),
  ];

  it("sans table des changements : tous les chauffeurs de la période, un récapitulatif chacun", () => {
    const d = destinatairesPublication({ affectations, changements: null, publiees: new Set() });
    expect(d.map((x) => [x.driverId, x.entrees.length])).toEqual([
      ["d1", 2],
      ["d2", 1],
    ]);
  });

  it("semaine jamais publiée : tout le monde ; déjà publiée : seulement les changements", () => {
    expect(destinatairesPublication({ affectations, changements: [], publiees: new Set() }).map((x) => x.driverId)).toEqual(["d1", "d2"]);
    const publiees = new Set([cleSemaine("s1", LUNDI)]);
    expect(destinatairesPublication({ affectations, changements: [], publiees })).toEqual([]);
    const d = destinatairesPublication({ affectations, changements: [chg({ id: "1", driver_id: "d2" }), chg({ id: "2", driver_id: "d2", nature: "modif" })], publiees });
    expect(d.map((x) => x.driverId)).toEqual(["d2"]);
  });

  it("retraits : tournée enlevée à un chauffeur, sans doublon, sauf s'il l'a récupérée", () => {
    const publiees = new Set([cleSemaine("s1", LUNDI)]);
    const changements = [
      chg({ id: "1", driver_id: "d9", tour_number: "T104", nature: "retrait" }),
      chg({ id: "2", driver_id: "d9", tour_number: "T104", nature: "retrait" }),
      chg({ id: "3", driver_id: "d1", nature: "retrait" }),
    ];
    const d = destinatairesPublication({ affectations, changements, publiees });
    expect(d.find((x) => x.driverId === "d9")).toMatchObject({ entrees: [], retraits: [{ id: "1" }] });
    // d1 tient toujours T101 lundi 06:30 : pas de retrait annoncé.
    expect(d.find((x) => x.driverId === "d1")?.retraits).toEqual([]);
  });
});

describe("message", () => {
  it("récapitulatif puis retraits", () => {
    const m = messagePublication({ entrees: [aff({})], retraits: [chg({ id: "1", tour_number: "T104", start_at: at("2026-10-22", "07:00"), nature: "retrait" })] });
    expect(m).toBe("Votre planning a été mis à jour :\nlun. 19/10 06:30 — n°T101 (AB-123-CD)\n\nRetirée de votre planning :\njeu. 22/10 — n°T104");
  });
  it("plus aucune tournée", () => {
    expect(messagePublication({ entrees: [], retraits: [] })).toBe("Votre planning a été mis à jour : aucune tournée prévue sur la période.");
  });
  it("texte de fin", () => {
    expect(textePublication(0)).toMatch(/Personne/);
    expect(textePublication(3)).toBe("3 chauffeurs prévenus (une notification chacun).");
  });
});
