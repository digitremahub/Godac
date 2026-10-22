import { describe, expect, it } from "vitest";
import { MARQUEUR_GO_NAVIGATION, MODULES_AVEC_CODE } from "@/lib/acces/catalogue";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";

const tout = new Set<string>(MODULES_AVEC_CODE);
const sans = (...m: string[]) => new Set([...tout].filter((x) => !m.includes(x)));

describe("resolveAlertUrl par type d'alerte", () => {
  it("planning : conflit et changement de véhicule → Planning au jour de la tournée", () => {
    expect(resolveAlertUrl("planning_entries", "planning_conflict", "e1", { role: "manager", modules: tout })).toBe("/exploitation/planning?entry=e1");
    expect(resolveAlertUrl("planning_entries", "vehicle_swap", "e1", { role: "direction", modules: tout })).toBe("/exploitation/planning?entry=e1");
    // Le chauffeur, s'il en reçoit une, ouvre son planning.
    expect(resolveAlertUrl("planning_entries", "vehicle_swap", "e1", { role: "chauffeur", modules: tout })).toBe("/moi/planning");
  });

  it("résumé hebdomadaire et rappel d'affectation → Mon planning du chauffeur", () => {
    expect(resolveAlertUrl("planning_entries", "weekly_planning_digest", null, { recipientUserId: "c1", role: "chauffeur", modules: tout })).toBe("/moi/planning?view=week");
    expect(resolveAlertUrl("planning_entries", "planning_assignment", "e1", { recipientUserId: "c1", role: "chauffeur", modules: tout })).toBe("/moi/planning?entry=e1");
  });

  it("carburant : toute alerte liée à un plein ouvre ce plein", () => {
    expect(resolveAlertUrl("fuel_entries", "consumption_anomaly", "f1", { role: "manager", modules: tout })).toBe("/carburant/pleins?plein=f1");
    expect(resolveAlertUrl("fuel_entries", "price_anomaly", "f1", { role: "direction" })).toBe("/carburant/pleins?plein=f1");
    expect(resolveAlertUrl("fuel_entries", "fuel_gap_explanation", "f1", { recipientUserId: "c1", role: "chauffeur" })).toBe("/carburant/pleins?plein=f1");
  });

  it("bulletin disponible → Mes fiches de paie (la direction : les fiches de l'entreprise)", () => {
    expect(resolveAlertUrl("payslips", "payslip_available", "p1", { recipientUserId: "c1", role: "chauffeur", modules: tout })).toBe("/moi/fiches-de-paie");
    expect(resolveAlertUrl("payslips", "payslip_available", "p1", { recipientUserId: "m1", role: "manager", conduit: false, modules: tout })).toBe("/moi/fiches-de-paie");
    expect(resolveAlertUrl("payslips", "payslip_available", "p1", { recipientUserId: "d1", role: "direction", modules: tout })).toBe("/equipe/paie/fiches");
  });
});

describe("resolveAlertUrl : jamais un écran refusé au rôle qui la reçoit", () => {
  it("rappel personnel d'un chauffeur lu par un manager qui ne conduit pas : centre de notifications, pas /moi/planning", () => {
    expect(resolveAlertUrl("planning_entries", "planning_assignment", "e1", { role: "manager", conduit: false, modules: tout })).toBe("/communication/alertes");
    expect(resolveAlertUrl("planning_entries", "planning_assignment", "e1", { role: "manager", conduit: true, modules: tout })).toBe("/moi/planning?entry=e1");
  });

  it("module coupé : centre de notifications plutôt qu'un écran « module non activé »", () => {
    expect(resolveAlertUrl("planning_entries", "planning_conflict", "e1", { role: "manager", modules: sans("planning") })).toBe("/communication/alertes");
    expect(resolveAlertUrl("vehicle_interventions", null, null, { role: "manager", modules: sans("maintenance_requests") })).toBe("/communication/alertes");
  });

  it("e-mail (modules inconnus) : seul le rôle et la conduite comptent", () => {
    expect(resolveAlertUrl("planning_entries", "planning_conflict", "e1", { role: "manager" })).toBe("/exploitation/planning?entry=e1");
    // Alerte personnelle : la personne qui la reçoit conduit.
    expect(resolveAlertUrl("planning_entries", "planning_assignment", "e1", { recipientUserId: "m1", role: "manager" })).toBe("/moi/planning?entry=e1");
  });

  it("comptable : écran d'encadrement refusé → alternative ou centre de notifications", () => {
    expect(resolveAlertUrl("planning_entries", "planning_conflict", "e1", { role: "comptable", modules: tout })).toBe("/communication/alertes");
    expect(resolveAlertUrl("payslips", "payslip_validation", "p1", { role: "comptable", modules: tout })).toBe("/equipe/paie");
  });

  it("compte GO Navigation : jamais un écran hors offre", () => {
    const go = new Set(["route_optimizer", MARQUEUR_GO_NAVIGATION]);
    expect(resolveAlertUrl("messages", "new_message", "u2", { role: "manager", conduit: true, modules: go })).toBe("/exploitation/colis");
  });
});
