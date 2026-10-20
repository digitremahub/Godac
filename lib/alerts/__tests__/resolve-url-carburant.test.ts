import { describe, expect, it } from "vitest";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";

describe("lien de l'alerte d'écart carburant", () => {
  it("explication demandée / réponse : le plein ouvert dans l'historique", () => {
    expect(resolveAlertUrl("fuel_entries", "fuel_gap_explanation", "p1", { recipientUserId: "u1", role: "chauffeur" })).toBe("/carburant/pleins?plein=p1");
    expect(resolveAlertUrl("fuel_entries", "fuel_gap_explanation", "p1", { role: "direction" })).toBe("/carburant/pleins?plein=p1");
  });
  it("sans plein lié : l'historique", () => {
    expect(resolveAlertUrl("fuel_entries", "fuel_gap_explanation", null)).toBe("/carburant/pleins");
  });
});
