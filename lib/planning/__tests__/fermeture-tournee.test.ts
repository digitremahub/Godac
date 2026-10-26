import { describe, expect, it } from "vitest";
import { decisionsFermeture, decisionsReouverture, texteFermeture, texteReouverture } from "@/lib/planning/fermeture-tournee";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import type { AffectationPlanning } from "@/lib/planning/semaine";

const at = (d: string, h: string) => parisWallTimeToUtcISOString(d, h);
const JOUR = "2026-11-11";
const ligne = (over: Partial<AffectationPlanning> = {}): AffectationPlanning => ({
  id: "e1",
  service_id: "s1",
  tour_number: "106",
  driver_id: null,
  vehicle_id: null,
  start_at: at(JOUR, "07:00"),
  status: "planned",
  ...over,
});
const fermer = (existantes: AffectationPlanning[], dates = [JOUR]) => decisionsFermeture({ dates, heure: "07:00", existantes, versUtc: at });

describe("fermer une tournée non affectée", () => {
  it("jour sans aucune ligne : crée la fermeture à l'heure de la tournée", () => {
    expect(fermer([])).toEqual([{ type: "creer", date: JOUR, startAt: at(JOUR, "07:00") }]);
  });

  it("ligne « à remplacer » ouverte : la ferme, sans en créer une seconde", () => {
    expect(fermer([ligne()])).toEqual([{ type: "fermer", date: JOUR, entreeIds: ["e1"] }]);
  });

  it("déjà fermée sans chauffeur : rien à faire (idempotent)", () => {
    expect(fermer([ligne({ tour_open: false })])).toEqual([{ type: "deja", date: JOUR }]);
  });

  it("chauffeur placé ou tournée démarrée : refusé, il faut retirer le chauffeur d'abord", () => {
    expect(fermer([ligne({ driver_id: "d1" })])).toEqual([{ type: "affectee", date: JOUR, raison: "chauffeur" }]);
    expect(fermer([ligne({ status: "in_progress" })])).toEqual([{ type: "affectee", date: JOUR, raison: "demarree" }]);
  });

  it("une affectation annulée ou d'un autre jour ne gêne pas", () => {
    expect(fermer([ligne({ driver_id: "d1", status: "cancelled" }), ligne({ id: "e2", driver_id: "d1", start_at: at("2026-11-12", "07:00") })])[0]!.type).toBe("creer");
  });

  it("une semaine : jours triés, dédoublonnés, chacun décidé à part (un jour refusé ne bloque pas les autres)", () => {
    const decisions = fermer([ligne({ id: "a", driver_id: "d1", start_at: at("2026-11-12", "07:00") }), ligne({ id: "b", start_at: at("2026-11-13", "07:00"), tour_open: false })], ["2026-11-13", JOUR, "2026-11-12", JOUR]);
    expect(decisions.map((d) => `${d.date}:${d.type}`)).toEqual([`${JOUR}:creer`, "2026-11-12:affectee", "2026-11-13:deja"]);
  });
});

describe("rouvrir", () => {
  const rouvrir = (existantes: AffectationPlanning[], dates = [JOUR]) => decisionsReouverture({ dates, existantes });

  it("supprime la ligne fermée sans chauffeur", () => {
    expect(rouvrir([ligne({ tour_open: false })])).toEqual([{ type: "rouvrir", date: JOUR, entreeIds: ["e1"] }]);
  });

  it("ouverte : rien ; fermée mais affectée : se rouvre par l'affectation, pas ici", () => {
    expect(rouvrir([ligne()])).toEqual([{ type: "rien", date: JOUR, raison: "ouverte" }]);
    expect(rouvrir([])).toEqual([{ type: "rien", date: JOUR, raison: "ouverte" }]);
    expect(rouvrir([ligne({ driver_id: "d1", tour_open: false })])).toEqual([{ type: "rien", date: JOUR, raison: "affectee" }]);
  });
});

describe("messages", () => {
  const libelle = (d: string) => `le ${d.slice(8)}`;
  it("fermeture", () => {
    expect(texteFermeture({ fermees: 3, deja: 0, refusees: [] }, libelle)).toBe("3 jours fermés");
    expect(texteFermeture({ fermees: 1, deja: 2, refusees: ["2026-11-12"] }, libelle)).toBe("1 jour fermé, 2 déjà fermés, le 12 non fermé (chauffeur placé ou tournée démarrée : retirez d'abord le chauffeur)");
    expect(texteFermeture({ fermees: 0, deja: 0, refusees: [] }, libelle)).toBe("Rien à fermer");
  });
  it("réouverture", () => {
    expect(texteReouverture(2)).toBe("2 jours rouverts");
    expect(texteReouverture(1)).toBe("1 jour rouvert");
    expect(texteReouverture(0)).toBe("Rien à rouvrir");
  });
});
