import { describe, expect, it } from "vitest";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";

describe("lien de l'alerte d'amende (I21)", () => {
  it("le chauffeur destinataire ouvre ses amendes, pas /flotte/amendes", () => {
    expect(resolveAlertUrl("fines", "fine_notification", "f1", { recipientUserId: "u1" })).toBe("/moi/amendes");
    expect(resolveAlertUrl("fines", "fine_notification", "f1", { role: "chauffeur" })).toBe("/moi/amendes");
  });
  it("l'encadrement (contestation adressée à la direction) ouvre la gestion des amendes", () => {
    expect(resolveAlertUrl("fines", "fine_notification", "f1", { role: "direction" })).toBe("/flotte/amendes");
    expect(resolveAlertUrl("fines", "fine_notification", "f1")).toBe("/flotte/amendes");
  });
  it("bulletins en attente de validation → Paie", () => {
    expect(resolveAlertUrl("payslips", "payslip_validation", "p1")).toBe("/equipe/paie");
  });
  it("les autres liens sont inchangés", () => {
    expect(resolveAlertUrl("fuel_entries", "price_anomaly", null)).toBe("/carburant/pleins");
    expect(resolveAlertUrl("messages", "new_message", "u2")).toBe("/communication/messenger?with=u2");
  });
});

describe("liens d'alerte par rôle destinataire (lot 3)", () => {
  it("chaque table et type mène à une adresse du catalogue, sans redirection", () => {
    expect(resolveAlertUrl("tank_deliveries", null, null)).toBe("/carburant/approvisionnements");
    expect(resolveAlertUrl("planning_entries", "planning_conflict", null)).toBe("/exploitation/historique");
    expect(resolveAlertUrl("planning_entries", "planning_assignment", "e1")).toBe("/moi/planning?entry=e1");
    expect(resolveAlertUrl("vehicles", "vehicle_document_request", "v1")).toBe("/flotte/vehicules/v1#papiers");
    expect(resolveAlertUrl("rental_maintenance_requests", null, null)).toBe("/flotte/loueurs");
    expect(resolveAlertUrl("support_requests", "support_request", null)).toBe("/communication/assistance");
    expect(resolveAlertUrl("convocations", null, null)).toBe("/communication/intranet");
  });
  it("un rôle qui ne peut pas ouvrir l'écran reçoit l'alternative ou le centre d'alertes", () => {
    expect(resolveAlertUrl("vehicle_interventions", null, null, { role: "chauffeur" })).toBe("/moi/signaler");
    expect(resolveAlertUrl("vehicle_interventions", null, null, { role: "manager" })).toBe("/flotte/entretien");
    expect(resolveAlertUrl("support_requests", null, null, { role: "chauffeur" })).toBe("/communication/alertes");
    expect(resolveAlertUrl("tank_deliveries", null, null, { role: "comptable" })).toBe("/carburant/approvisionnements");
  });
  it("table inconnue : pas de lien (repli sur le centre d'alertes par l'appelant)", () => {
    expect(resolveAlertUrl("inconnue", null, null)).toBeNull();
  });
});
