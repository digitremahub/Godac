import { describe, expect, it } from "vitest";
import { changementsHeure, modelesDeLaTournee, texteChangementHeure } from "@/lib/planning/heure";
import { decisionsAffectation } from "@/lib/planning/affectation";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import type { AffectationPlanning } from "@/lib/planning/semaine";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const aff = (p: Partial<AffectationPlanning> & { id: string }): AffectationPlanning => ({ service_id: "s1", tour_number: "T101", driver_id: "d1", vehicle_id: null, start_at: at("2026-10-19", "07:00"), status: "planned", ...p });
const base = { serviceId: "s1", tourNumber: "T101", heure: "06:00", versUtc: parisWallTimeToUtcISOString };

describe("changement d'heure d'une tournée", () => {
  const entrees = [
    aff({ id: "lun" }),
    aff({ id: "mar", start_at: at("2026-10-20", "07:00"), driver_id: null }),
    aff({ id: "sam", start_at: at("2026-10-24", "07:00") }),
    aff({ id: "dim-suivant", start_at: at("2026-10-26", "07:00") }),
    aff({ id: "autre-tournee", tour_number: "T102" }),
    aff({ id: "autre-service", service_id: "s2" }),
    aff({ id: "demarree", start_at: at("2026-10-21", "07:00"), status: "in_progress" }),
    aff({ id: "deja", start_at: at("2026-10-22", "06:00") }),
  ];

  it("seulement ce jour", () => {
    const r = changementsHeure(entrees, { ...base, debut: "2026-10-19", fin: "2026-10-19" });
    expect(r.map((c) => c.entree.id)).toEqual(["lun"]);
    expect(r[0]).toMatchObject({ date: "2026-10-19", ancienne: "07:00", prevenir: true, nouveauStartAt: at("2026-10-19", "06:00") });
  });

  it("la semaine : même tournée, même service, prévues seulement, heure différente", () => {
    const r = changementsHeure(entrees, { ...base, debut: "2026-10-19", fin: "2026-10-25" });
    expect(r.map((c) => c.entree.id)).toEqual(["lun", "mar", "sam"]);
    // « mar » n'a pas de chauffeur : personne à prévenir.
    expect(r.map((c) => c.prevenir)).toEqual([true, false, true]);
  });

  it("le samedi à 06:00, l'heure se garde en heure de Paris (changement d'heure compris)", () => {
    const r = changementsHeure([aff({ id: "x", start_at: at("2026-10-24", "07:00") })], { ...base, debut: "2026-10-24", fin: "2026-10-24" });
    expect(r[0]!.nouveauStartAt).toBe(at("2026-10-24", "06:00"));
    const hiver = changementsHeure([aff({ id: "y", start_at: at("2026-11-02", "07:00") })], { ...base, debut: "2026-11-02", fin: "2026-11-02" });
    expect(hiver[0]!.nouveauStartAt).toBe(at("2026-11-02", "06:00"));
  });

  it("rien si l'heure est déjà la bonne", () => {
    expect(changementsHeure(entrees, { ...base, heure: "07:00", debut: "2026-10-19", fin: "2026-10-19" })).toEqual([]);
  });

  it("modèles de la tournée", () => {
    const m = [
      { id: "1", service_id: "s1", tour_number: "T101" },
      { id: "2", service_id: "s1", tour_number: "T102" },
      { id: "3", service_id: "s2", tour_number: "T101" },
    ];
    expect(modelesDeLaTournee(m, "s1", "T101").map((x) => x.id)).toEqual(["1"]);
    expect(modelesDeLaTournee(m, "s1", "T999")).toEqual([]);
  });

  it("textes", () => {
    expect(texteChangementHeure({ modifiees: 3, prevenus: 2, heure: "06:00" })).toContain("3 affectations passées à 06:00");
    expect(texteChangementHeure({ modifiees: 0, prevenus: 0, heure: "06:00", modele: true })).toBe("Heure habituelle passée à 06:00");
    expect(texteChangementHeure({ modifiees: 0, prevenus: 0, heure: "06:00" })).toBe("Rien à changer");
  });
});

describe("placer avec une heure choisie", () => {
  const versUtc = parisWallTimeToUtcISOString;
  const existantes = [aff({ id: "vide", driver_id: null, start_at: at("2026-10-20", "07:00") })];

  it("case vide : créée à l'heure choisie", () => {
    const d = decisionsAffectation({ dates: ["2026-10-24"], driverId: "d2", heure: "06:00", existantes: [], absent: () => false, versUtc });
    expect(d).toEqual([{ type: "creer", date: "2026-10-24", startAt: at("2026-10-24", "06:00"), driverId: "d2" }]);
  });

  it("affectation existante : garde son heure, sauf heure imposée", () => {
    const sans = decisionsAffectation({ dates: ["2026-10-20"], driverId: "d2", heure: "06:00", existantes, absent: () => false, versUtc });
    expect(sans).toEqual([{ type: "changer", date: "2026-10-20", entreeId: "vide", ancienChauffeur: null }]);
    const avec = decisionsAffectation({ dates: ["2026-10-20"], driverId: "d2", heure: "06:00", imposerHeure: true, existantes, absent: () => false, versUtc });
    expect(avec).toEqual([{ type: "changer", date: "2026-10-20", entreeId: "vide", ancienChauffeur: null, startAt: at("2026-10-20", "06:00") }]);
  });

  it("heure imposée identique : pas de changement d'heure", () => {
    const d = decisionsAffectation({ dates: ["2026-10-20"], driverId: "d2", heure: "07:00", imposerHeure: true, existantes, absent: () => false, versUtc });
    expect(d[0]).toEqual({ type: "changer", date: "2026-10-20", entreeId: "vide", ancienChauffeur: null });
  });
});
