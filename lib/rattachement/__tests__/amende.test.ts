import { describe, expect, it } from "vitest";
import { libelleSuggestionAmende, rapprocherAmende, type CreneauPlanning } from "@/lib/rattachement/amende";

// 12/10/2026 : heure d'été, Paris = UTC+2.
const V = "veh-1";
const creneau = (o: Partial<CreneauPlanning> & { id: string }): CreneauPlanning => ({
  driverId: `drv-${o.id}`,
  driverName: `Chauffeur ${o.id}`,
  tourNumber: "12",
  vehicleId: V,
  startAt: "2026-10-12T05:10:00Z", // 07:10 Paris
  endAt: "2026-10-12T14:45:00Z", // 16:45 Paris
  status: "done",
  ...o,
});

describe("rapprochement amende ↔ planning", () => {
  it("heure couverte par la tournée du véhicule : exact", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T08:00:00Z", creneaux: [creneau({ id: "a" })] });
    expect(r.confiance).toBe("exact");
    expect(r.suggestion?.driverId).toBe("drv-a");
    expect(r.suggestion?.planningEntryId).toBe("a");
  });

  it("libellé de suggestion avec tournée, véhicule et horaires (heure de Paris)", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T08:00:00Z", creneaux: [creneau({ id: "a", driverName: "Jean Dupont" })] });
    expect(libelleSuggestionAmende(r.suggestion!, "AB-123-CD")).toBe("Suggestion : Jean Dupont, tournée n°12, véhicule AB-123-CD, de 07:10 à 16:45");
  });

  it("même jour hors horaires : probable", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T18:30:00Z", creneaux: [creneau({ id: "a" })] });
    expect(r.confiance).toBe("probable");
    expect(r.suggestion?.driverId).toBe("drv-a");
  });

  it("tournée en cours sans heure de fin : la journée est couverte", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T19:00:00Z", creneaux: [creneau({ id: "a", endAt: null, status: "in_progress" })] });
    expect(r.confiance).toBe("exact");
  });

  it("tournée seulement prévue (non pointée) : probable, jamais exact", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T08:00:00Z", creneaux: [creneau({ id: "a", status: "planned" })] });
    expect(r.confiance).toBe("probable");
  });

  it("autre véhicule ou autre jour : aucun", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T08:00:00Z",
      creneaux: [creneau({ id: "a", vehicleId: "autre" }), creneau({ id: "b", startAt: "2026-10-11T05:00:00Z", endAt: "2026-10-11T14:00:00Z" })],
    });
    expect(r.confiance).toBe("aucun");
    expect(r.suggestion).toBeNull();
  });

  it("créneaux qui se chevauchent sans passage de main daté : pas de suggestion, choix manuel", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T08:00:00Z", creneaux: [creneau({ id: "a" }), creneau({ id: "b" })] });
    expect(r.confiance).toBe("exact");
    expect(r.suggestion).toBeNull();
    expect(r.candidats).toHaveLength(2);
  });

  it("chevauchement : le dernier à avoir pris le véhicule avant l'infraction l'emporte", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T12:00:00Z",
      creneaux: [creneau({ id: "a" }), creneau({ id: "b", startAt: "2026-10-12T10:00:00Z", endAt: "2026-10-12T16:00:00Z" })],
    });
    expect(r.suggestion?.driverId).toBe("drv-b");
  });

  it("changement de véhicule au départ : le chauffeur qui a pris le véhicule l'a depuis l'heure du changement", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T09:00:00Z",
      creneaux: [creneau({ id: "a", vehicleId: "autre" })],
      prises: [{ planningEntryId: "a", vehicleId: V, driverId: "drv-a", stage: "depart", at: "2026-10-12T05:15:00Z" }],
    });
    expect(r.confiance).toBe("exact");
    expect(r.suggestion?.driverId).toBe("drv-a");
  });

  it("changement de véhicule constaté au retour (heure inconnue) : probable", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T09:00:00Z",
      creneaux: [creneau({ id: "a" })],
      prises: [{ planningEntryId: "a", vehicleId: V, driverId: "drv-a", stage: "retour", at: "2026-10-12T14:45:00Z" }],
    });
    expect(r.confiance).toBe("probable");
  });

  it("tournée colis avec ce véhicule et position GPS proche : exact", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T09:00:00Z",
      creneaux: [],
      tournees: [{ runId: "r1", driverId: "drv-x", driverName: "X", vehicleId: V, runDate: "2026-10-12", planningEntryId: null }],
      points: [{ runId: "r1", at: "2026-10-12T09:05:00Z", lat: 48.85, lng: 2.35 }],
    });
    expect(r.confiance).toBe("exact");
    expect(r.suggestion?.runId).toBe("r1");
    expect(r.suggestion?.gps?.lat).toBe(48.85);
  });

  it("tournée colis du jour sans position : probable", () => {
    const r = rapprocherAmende({
      vehicleId: V,
      infractionAt: "2026-10-12T09:00:00Z",
      creneaux: [],
      tournees: [{ runId: "r1", driverId: "drv-x", driverName: "X", vehicleId: V, runDate: "2026-10-12", planningEntryId: null }],
      points: [{ runId: "r1", at: "2026-10-12T11:00:00Z", lat: 48.85, lng: 2.35 }],
    });
    expect(r.confiance).toBe("probable");
  });

  it("une tournée annulée est ignorée", () => {
    const r = rapprocherAmende({ vehicleId: V, infractionAt: "2026-10-12T08:00:00Z", creneaux: [creneau({ id: "a", status: "cancelled" })] });
    expect(r.confiance).toBe("aucun");
  });
});
