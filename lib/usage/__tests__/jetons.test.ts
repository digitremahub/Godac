import { describe, expect, it, vi } from "vitest";
import { journaliserJetons, unitesReelles } from "@/lib/usage/jetons";

describe("unités réelles d'un appel d'IA", () => {
  it("au moins 1 unité, même sans jetons connus", () => {
    expect(unitesReelles({ entree: null, sortie: null })).toBe(1);
    expect(unitesReelles({ entree: 100, sortie: 50 })).toBe(1);
  });
  it("une page de bordereau dense vaut plusieurs unités", () => {
    // 6 000 jetons lus + 6 000 écrits : (1 200 + 6 000) / 400 × 3 = 54 unités.
    expect(unitesReelles({ entree: 6000, sortie: 6000 })).toBe(54);
    expect(unitesReelles({ entree: 1500, sortie: 800 })).toBeGreaterThan(unitesReelles({ entree: 1500, sortie: 200 }));
  });
  it("plafonne", () => {
    expect(unitesReelles({ entree: 1e9, sortie: 1e9 })).toBe(100);
  });
});

function admin(error: { code?: string; message?: string } | null = null) {
  const eq = vi.fn(async () => ({ error }));
  const update = vi.fn((_valeurs: Record<string, unknown>) => ({ eq }));
  return { client: { from: vi.fn(() => ({ update })) } as never, update, eq };
}

describe("journalisation des jetons", () => {
  it("met à jour l'événement de consommation sans toucher à `units`", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, update, eq } = admin();
    await journaliserJetons(client, "evt-1", "ocr_bordereau", { entree: 3000, sortie: 2000 });
    expect(update).toHaveBeenCalledWith({ tokens_entree: 3000, tokens_sortie: 2000, unites_reelles: expect.any(Number) });
    expect(Object.keys(update.mock.calls[0]![0])).not.toContain("units");
    expect(eq).toHaveBeenCalledWith("id", "evt-1");
  });
  it("sans événement : seulement le journal", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client, update } = admin();
    await journaliserJetons(client, null, "ocr_bordereau", { entree: 1, sortie: 1 });
    expect(update).not.toHaveBeenCalled();
  });
  it("colonnes absentes (migration non appliquée) : aucune exception", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const { client } = admin({ code: "42703" });
    await expect(journaliserJetons(client, "evt-1", "x", { entree: 1, sortie: 1 })).resolves.toBeUndefined();
  });
});
