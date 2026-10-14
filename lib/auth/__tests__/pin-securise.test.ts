import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({}) }));

import { motDePassePin, verrouActif } from "@/lib/auth/pin-securise";

const ORIGINAL = process.env.PIN_PEPPER;
afterEach(() => {
  process.env.PIN_PEPPER = ORIGINAL;
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
  it("verrou", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    expect(verrouActif(null, now)).toBeNull();
    expect(verrouActif("2026-10-13T09:59:00Z", now)).toBeNull();
    expect(verrouActif("2026-10-13T10:14:10Z", now)).toBe(15);
  });
});
