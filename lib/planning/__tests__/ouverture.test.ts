import { describe, expect, it } from "vitest";
import {
  compterFermees,
  confirmationFermeture,
  estOuverte,
  filtrerParOuverture,
  libelleFermeture,
  ligneCorrespond,
  messageTourneeFermee,
  peutChangerOuverture,
} from "@/lib/planning/ouverture";
import { decisionsAffectation } from "@/lib/planning/affectation";
import { estModifiable, type AffectationPlanning } from "@/lib/planning/semaine";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";

const SERVICE = "s1";
const entree = (driver: string | null = "chauffeur-1", status = "planned") => ({ service_id: SERVICE, driver_id: driver, status });
const qui = (role: string, over: Partial<Parameters<typeof peutChangerOuverture>[0]> = {}) =>
  peutChangerOuverture({ role, userId: "moi", serviceIds: [SERVICE], entree: entree(), directionCount: 2, ...over });

describe("tournée ouverte / fermée", () => {
  it("est ouverte par défaut, y compris sans la colonne de la migration", () => {
    expect(estOuverte({})).toBe(true);
    expect(estOuverte({ tour_open: null })).toBe(true);
    expect(estOuverte({ tour_open: true })).toBe(true);
    expect(estOuverte({ tour_open: false })).toBe(false);
  });

  it("filtre Ouvertes / Fermées / Toutes", () => {
    const l = [{ id: 1, tour_open: true }, { id: 2, tour_open: false }, { id: 3 }];
    expect(filtrerParOuverture(l, "toutes")).toHaveLength(3);
    expect(filtrerParOuverture(l, "ouvertes").map((x) => x.id)).toEqual([1, 3]);
    expect(filtrerParOuverture(l, "fermees").map((x) => x.id)).toEqual([2]);
  });

  it("une tournée sans affectation compte comme ouverte pour le filtre", () => {
    expect(ligneCorrespond("ouvertes", [])).toBe(true);
    expect(ligneCorrespond("fermees", [])).toBe(false);
    expect(ligneCorrespond("fermees", [{ tour_open: false }])).toBe(true);
    expect(ligneCorrespond("ouvertes", [{ tour_open: false }])).toBe(false);
    expect(ligneCorrespond("ouvertes", [{ tour_open: false }, { tour_open: true }])).toBe(true);
  });

  it("compte les fermées sans les annulées", () => {
    expect(compterFermees([{ tour_open: false }, { tour_open: false, status: "cancelled" }, { tour_open: true }])).toBe(1);
  });
});

describe("droits d'ouverture et de fermeture", () => {
  it("direction et exploitation : toutes les tournées de l'organisation", () => {
    expect(qui("direction", { serviceIds: [] }).ok).toBe(true);
    expect(qui("exploitation", { serviceIds: [] }).ok).toBe(true);
  });

  it("manager : seulement son service", () => {
    expect(qui("manager").ok).toBe(true);
    const autre = qui("manager", { serviceIds: ["autre"] });
    expect(autre.ok).toBe(false);
    expect(autre.ok ? "" : autre.raison).toContain("son service");
  });

  it("chauffeur et comptable : refusés", () => {
    expect(qui("chauffeur").ok).toBe(false);
    expect(qui("comptable").ok).toBe(false);
  });

  it("on ne ferme pas sa propre tournée, sauf une direction seule (auto-validation)", () => {
    const sienne = entree("moi");
    expect(qui("manager", { entree: sienne }).ok).toBe(false);
    expect(qui("exploitation", { entree: sienne }).ok).toBe(false);
    expect(qui("direction", { entree: sienne, directionCount: 2 }).ok).toBe(false);
    expect(qui("direction", { entree: sienne, directionCount: 1 })).toEqual({ ok: true, autoValidee: true });
  });

  it("une tournée terminée ou annulée n'a plus d'ouverture à changer", () => {
    expect(qui("direction", { entree: entree("x", "done") }).ok).toBe(false);
    expect(qui("direction", { entree: entree("x", "cancelled") }).ok).toBe(false);
    expect(qui("direction", { entree: entree("x", "in_progress") }).ok).toBe(true);
  });
});

describe("messages", () => {
  it("dit qui a fermé la tournée (chauffeur et encadrement)", () => {
    const iso = parisWallTimeToUtcISOString("2026-10-26", "14:05");
    expect(messageTourneeFermee("Marie D.", iso)).toBe("Tournée fermée par Marie D. le 26/10 à 14:05. Contactez l'exploitation pour la faire rouvrir.");
    expect(messageTourneeFermee("Marie D.", iso, "encadrement")).toContain("Rouvrez-la");
    expect(messageTourneeFermee(null)).toBe("Tournée fermée. Contactez l'exploitation pour la faire rouvrir.");
    expect(libelleFermeture("Marie D.", iso)).toBe("Fermée par Marie D. le 26/10 à 14:05");
  });

  it("demande confirmation seulement si une fiche colis liée est en cours", () => {
    expect(confirmationFermeture(0)).toBeNull();
    expect(confirmationFermeture(1)).toContain("ne la supprime pas");
    expect(confirmationFermeture(2)).toContain("2 tournées colis liées");
  });
});

describe("tournée fermée = affectation figée", () => {
  const at = (d: string, h: string) => parisWallTimeToUtcISOString(d, h);
  const existante = (over: Partial<AffectationPlanning> = {}): AffectationPlanning => ({
    id: "e1",
    service_id: SERVICE,
    tour_number: "T1",
    driver_id: "a",
    vehicle_id: null,
    start_at: at("2026-10-26", "07:00"),
    status: "planned",
    ...over,
  });
  const base = { dates: ["2026-10-26"], driverId: "b", heure: "07:00", absent: () => false, versUtc: at };

  it("n'est plus modifiable", () => {
    expect(estModifiable({ status: "planned" })).toBe(true);
    expect(estModifiable({ status: "planned", tour_open: false })).toBe(false);
  });

  it("changer de chauffeur est ignoré tant qu'elle est fermée", () => {
    expect(decisionsAffectation({ ...base, existantes: [existante()] })[0]!.type).toBe("changer");
    expect(decisionsAffectation({ ...base, existantes: [existante({ tour_open: false })] })).toEqual([{ type: "rien", date: "2026-10-26", raison: "figee" }]);
  });

  it("rouvrir rétablit le changement", () => {
    expect(decisionsAffectation({ ...base, existantes: [existante({ tour_open: true })] })[0]!.type).toBe("changer");
  });
});
