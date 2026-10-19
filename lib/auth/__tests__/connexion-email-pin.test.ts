import { describe, expect, it } from "vitest";
import { choisirCompte, connexionEmailPinSchema, motifIlikeExact, type CompteCandidat } from "@/lib/auth/connexion-email-pin";

const compte = (id: string, extra: Partial<CompteCandidat> = {}): CompteCandidat => ({
  id,
  email: `chauffeur-${id}@org.godac.local`,
  contact_email: null,
  organization_id: "org",
  full_name: id,
  auth_method: "pin",
  pin_set_at: "2026-10-01T00:00:00Z",
  active: true,
  pending_approval: false,
  ...extra,
});

describe("connexion e-mail + PIN : format (audit E6)", () => {
  it("accepte un PIN de 4 à 32 chiffres", () => {
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "1234" }).success).toBe(true);
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "12345678901234567890123456789012" }).success).toBe(true);
  });
  it("refuse un PIN trop court, non numérique ou trop long", () => {
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "123" }).success).toBe(false);
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "12a4" }).success).toBe(false);
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "\\d1234" }).success).toBe(false);
    expect(connexionEmailPinSchema.safeParse({ email: "a@b.fr", pin: "1".repeat(33) }).success).toBe(false);
  });
});

describe("choix du compte", () => {
  it("retrouve un chauffeur PIN par son e-mail de contact", () => {
    const r = choisirCompte([compte("a", { contact_email: "Jean@Exemple.fr " })], "jean@exemple.fr");
    expect(r).toEqual({ ok: true, compte: expect.objectContaining({ id: "a" }) });
  });
  it("refuse une adresse portée par plusieurs comptes PIN", () => {
    const r = choisirCompte([compte("a", { contact_email: "x@y.fr" }), compte("b", { contact_email: "x@y.fr", organization_id: "autre" })], "x@y.fr");
    expect(r).toEqual({ ok: false, raison: "ambigu" });
  });
  it("ignore les comptes non PIN et les doublons de la même ligne", () => {
    const a = compte("a", { email: "x@y.fr", contact_email: "x@y.fr" });
    expect(choisirCompte([a, a, compte("c", { auth_method: "email", email: "x@y.fr" })], "x@y.fr")).toMatchObject({ ok: true });
    expect(choisirCompte([compte("c", { auth_method: "email", email: "x@y.fr" })], "x@y.fr")).toEqual({ ok: false, raison: "introuvable" });
  });
  it("échappe les jokers ilike", () => {
    expect(motifIlikeExact("a_b%c@d.fr")).toBe("a\\_b\\%c@d.fr");
  });
});
