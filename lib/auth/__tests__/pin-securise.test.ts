import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({}) }));

import { motDePassePin, motsDePasseHerites, verrouActif } from "@/lib/auth/pin-securise";

const ORIGINAL = process.env.PIN_PEPPER;
const ORIGINAL_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
afterEach(() => {
  process.env.PIN_PEPPER = ORIGINAL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIGINAL_SERVICE;
});

describe("code PIN sécurisé", () => {
  it("mot de passe dérivé : jamais le PIN, propre au compte", () => {
    process.env.PIN_PEPPER = "secret-de-test";
    const a = motDePassePin("user-a", "1379");
    expect(a).not.toContain("1379");
    expect(a).toHaveLength(64);
    expect(motDePassePin("user-b", "1379")).not.toBe(a);
    expect(motDePassePin("user-a", "1379")).toBe(a);
  });
  it("passage à PIN_PEPPER : l'empreinte faite avec la clé service reste acceptée", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-service";
    delete process.env.PIN_PEPPER;
    const avant = motDePassePin("user-a", "1379");
    expect(motsDePasseHerites("user-a", "1379")).toEqual(["1379"]);

    process.env.PIN_PEPPER = "nouveau-poivre";
    const apres = motDePassePin("user-a", "1379");
    expect(apres).not.toBe(avant);
    expect(motsDePasseHerites("user-a", "1379")).toEqual([avant, "1379"]);
  });
  it("verrou", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(verrouActif(null, now)).toBeNull();
    expect(verrouActif("2026-10-13T09:59:00Z", now)).toBeNull();
    expect(verrouActif("2026-10-13T10:14:10Z", now)).toBe(15);
  });
});
