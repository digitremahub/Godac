import { describe, expect, it } from "vitest";
import { heuresDuMois, sourceHeures, type EntreePlanning, type Pointage } from "../heures";

// Octobre 2026 : heure d'été jusqu'au 25 (Paris = UTC+2).
const P = (jour: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return new Date(Date.UTC(Number(jour.slice(0, 4)), Number(jour.slice(5, 7)) - 1, Number(jour.slice(8, 10)), h - 2, m)).toISOString();
};
const J = "2026-10-06";
const maintenant = new Date("2026-10-31T20:00:00Z");
const base = { debut: "2026-10-01", fin: "2026-10-31", absences: [], maintenant };
const tournee = (debutPrevu: string | null, depart: string, retour: string | null, status = "done"): EntreePlanning => ({
  debutPrevu: debutPrevu ? P(J, debutPrevu) : null,
  debut: P(J, depart),
  fin: retour ? P(J, retour) : null,
  status,
});
const badge = (e: string, s: string | null, jour = J): Pointage => ({ entree: P(jour, e), sortie: s ? P(jour, s) : null });

describe("conducteur : règle par défaut", () => {
  const conducteur = { conducteur: true };

  it("sans pointage : début prévu au planning (picking), fin au retour de la dernière tournée", () => {
    const r = heuresDuMois({ ...base, pointages: [], planning: [tournee("06:00", "07:10", "11:00"), tournee("12:00", "12:05", "15:30")], profil: conducteur });
    expect(r.total).toBe(9.5);
    expect(r.jours[0]).toMatchObject({ jour: J, origineDebut: "planning", origineFin: "retour", heures: 9.5 });
    // Plus de 6 h sans pause pointée : avertissement, aucune déduction.
    expect(r.alertes.map((a) => a.code)).toEqual(["sans_pause"]);
  });

  it("pointage d'arrivée et de sortie prioritaires, pauses pointées déduites", () => {
    const r = heuresDuMois({ ...base, pointages: [badge("05:45", "11:15"), badge("11:45", "15:40")], planning: [tournee("06:00", "07:10", "15:30")], profil: conducteur });
    expect(r.jours[0]).toMatchObject({ origineDebut: "badge", origineFin: "badge", pauseMinutes: 30, heures: 9.42 });
    expect(r.alertes).toEqual([]);
  });

  it("écart de plus de 30 min entre la sortie pointée et le retour", () => {
    const r = heuresDuMois({ ...base, pointages: [badge("06:00", "16:30")], planning: [tournee("06:00", "07:00", "15:30")], profil: conducteur });
    expect(r.alertes.map((a) => a.code)).toContain("ecart_retour");
  });

  it("pointage incomplet : entrée sans sortie, fin au retour de tournée", () => {
    const r = heuresDuMois({ ...base, pointages: [badge("05:30", null)], planning: [tournee("06:00", "07:00", "13:00")], profil: conducteur });
    expect(r.jours[0]).toMatchObject({ origineDebut: "badge", origineFin: "retour", heures: 7.5 });
    expect(r.alertes.map((a) => a.code)).toContain("pointage_incomplet");
  });

  it("début prévu inconnu (affectation ancienne) : heure de départ", () => {
    const r = heuresDuMois({ ...base, pointages: [], planning: [tournee(null, "07:00", "12:00")], profil: conducteur });
    expect(r.jours[0]).toMatchObject({ origineDebut: "depart", heures: 5 });
  });

  it("jour travaillé sans aucune source exploitable", () => {
    const r = heuresDuMois({ ...base, pointages: [], planning: [tournee("06:00", "07:00", null, "in_progress")], profil: conducteur });
    expect(r.total).toBe(0);
    expect(r.alertes.map((a) => a.code)).toEqual(["sans_source"]);
  });

  it("jours à venir ignorés ; tournée prévue jamais démarrée : rien", () => {
    const r = heuresDuMois({ ...base, maintenant: new Date(P(J, "05:00")), pointages: [], planning: [tournee("06:00", "06:00", null, "planned")], profil: conducteur });
    expect(r.jours).toEqual([]);
    expect(r.alertes).toEqual([]);
  });
});

describe("autres salariés : pointage seul", () => {
  const bureau = { conducteur: false };
  const presence: EntreePlanning = { debutPrevu: P(J, "09:00"), debut: P(J, "09:00"), fin: P(J, "17:00"), status: "presence" };

  it("pointage : sessions, pause déduite", () => {
    const r = heuresDuMois({ ...base, pointages: [badge("08:55", "12:30"), badge("13:30", "17:05")], planning: [presence], profil: bureau });
    expect(r.jours[0]).toMatchObject({ origineDebut: "badge", origineFin: "badge", pauseMinutes: 60 });
    expect(r.total).toBeCloseTo(7.17, 2);
  });

  it("jour planifié sans pointage : horaires prévus et signalement", () => {
    const r = heuresDuMois({ ...base, pointages: [], planning: [presence], profil: bureau });
    expect(r.jours[0]).toMatchObject({ origineDebut: "planning", origineFin: "planning", heures: 8 });
    expect(r.alertes.map((a) => a.code)).toEqual(["sans_pointage", "sans_pause"]);
  });

  it("option « pointage seul » : rien sans pointage", () => {
    const r = heuresDuMois({ ...base, source: "badge", pointages: [], planning: [presence], profil: bureau });
    expect(r.total).toBe(0);
    expect(r.alertes.map((a) => a.code)).toEqual(["sans_pointage"]);
  });
});

describe("absences et options", () => {
  it("jour d'arrêt : aucune heure attendue, aucune alerte de pointage", () => {
    const r = heuresDuMois({
      ...base,
      absences: [{ du: J, au: J, nature: "arret" }],
      pointages: [],
      planning: [{ debutPrevu: P(J, "09:00"), debut: P(J, "09:00"), fin: P(J, "17:00"), status: "presence" }],
      profil: { conducteur: false },
    });
    expect(r.total).toBe(0);
    expect(r.alertes).toEqual([]);
    expect(r.jours).toEqual([expect.objectContaining({ jour: J, absence: "arret", heures: 0 })]);
  });

  it("activité pendant un arrêt : comptée, signalée", () => {
    const r = heuresDuMois({ ...base, absences: [{ du: J, au: J, nature: "arret" }], pointages: [badge("08:00", "12:00")], planning: [], profil: { conducteur: true } });
    expect(r.total).toBe(4);
    expect(r.alertes.map((a) => a.code)).toEqual(["pendant_absence"]);
  });

  it("option départ → retour (ancienne règle)", () => {
    const r = heuresDuMois({ ...base, source: "tournees", pointages: [badge("05:00", "16:00")], planning: [tournee("06:00", "07:00", "12:00")], profil: { conducteur: true } });
    expect(r.total).toBe(5);
    expect(r.jours[0]).toMatchObject({ origineDebut: "depart", origineFin: "retour" });
  });

  it("valeur de réglage inconnue : règle par défaut", () => {
    expect(sourceHeures(undefined)).toBe("regle");
    expect(sourceHeures("badge")).toBe("badge");
  });
});
