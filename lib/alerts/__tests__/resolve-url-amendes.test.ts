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
    expect(resolveAlertUrl("messages", "new_message", "u2")).toBe("/messenger?with=u2");
  });
});
