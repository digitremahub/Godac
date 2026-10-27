import { describe, expect, it } from "vitest";
import { cleAlerteImpaye, impayeAffiche, joursDepuisImpaye, messageImpaye } from "@/lib/stripe/impaye";

describe("impayé Stripe", () => {
  it("clé par facture et par tentative", () => {
    expect(cleAlerteImpaye({ id: "in_1", attempt_count: 2 })).toBe("paiement:in_1:2");
    expect(cleAlerteImpaye({ id: "in_1" })).toBe("paiement:in_1:1");
  });
  it("message sans blocage", () => {
    const m = messageImpaye({ id: "in_1", amount_due: 12900, currency: "eur", attempt_count: 2 });
    expect(m).toContain("a échoué");
    expect(m).toContain("restent accessibles");
  });
  it("bandeau : impayé enregistré ou past_due", () => {
    expect(impayeAffiche({ payment_failed_at: "2026-10-01T00:00:00Z" })).toBe(true);
    expect(impayeAffiche({ subscription_status: "past_due" })).toBe(true);
    expect(impayeAffiche({ subscription_status: "active" })).toBe(false);
  });
  it("jours depuis l'impayé", () => {
    expect(joursDepuisImpaye("2026-10-20T00:00:00Z", new Date("2026-10-27T12:00:00Z"))).toBe(7);
    expect(joursDepuisImpaye(null)).toBeNull();
  });
});
