import { describe, expect, it } from "vitest";
import { ESSAIS_ACTIVATION_MAX, evaluerActivation, genererCodeActivation, normaliserCodeActivation } from "@/lib/auth/code-activation";

const maintenant = new Date("2026-10-19T12:00:00Z");
const valide = { expires_at: "2026-10-20T12:00:00Z", failed_count: 0 };
const egal = (attendu: string) => (code: string) => normaliserCodeActivation(code) === attendu;

describe("code d'activation après réinitialisation du PIN", () => {
  it("format XXXX-XXXX sans caractères ambigus", () => {
    for (let i = 0; i < 50; i++) expect(genererCodeActivation()).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/);
  });
  it("aucune activation en attente : création libre (premier badge)", () => {
    expect(evaluerActivation(null, undefined, () => false, maintenant)).toEqual({ ok: true });
  });
  it("activation en attente : code exigé", () => {
    expect(evaluerActivation(valide, undefined, egal("ABCDEFGH"), maintenant)).toEqual({ ok: false, raison: "absent" });
    expect(evaluerActivation(valide, "abcd-efgh", egal("ABCDEFGH"), maintenant)).toEqual({ ok: true });
    expect(evaluerActivation(valide, "ZZZZ-ZZZZ", egal("ABCDEFGH"), maintenant)).toEqual({ ok: false, raison: "incorrect" });
  });
  it("code expiré ou bloqué après trop d'essais", () => {
    expect(evaluerActivation({ ...valide, expires_at: "2026-10-19T11:00:00Z" }, "ABCD-EFGH", egal("ABCDEFGH"), maintenant)).toEqual({ ok: false, raison: "expire" });
    expect(evaluerActivation({ ...valide, failed_count: ESSAIS_ACTIVATION_MAX }, "ABCD-EFGH", egal("ABCDEFGH"), maintenant)).toEqual({ ok: false, raison: "bloque" });
  });
});
