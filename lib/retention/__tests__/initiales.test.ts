import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({}) }));

import { initialesDestinataire } from "@/lib/retention/purge";

describe("initiales du destinataire après 30 jours", () => {
  it("réduit le nom aux initiales", () => {
    expect(initialesDestinataire("Jean-Marc Dupont")).toBe("J.-M. D.");
    expect(initialesDestinataire("marie curie")).toBe("M. C.");
  });
  it("idempotent et vide", () => {
    expect(initialesDestinataire("J.-M. D.")).toBe("J.-M. D.");
    expect(initialesDestinataire(null)).toBeNull();
    expect(initialesDestinataire("  ")).toBeNull();
  });
});
