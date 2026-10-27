import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const isModuleEnabled = vi.fn();
vi.mock("@/lib/organization/modules", () => ({ isModuleEnabled: (...a: unknown[]) => isModuleEnabled(...a) }));

import { moduleActif } from "@/lib/colis/serveur";
import { memoriserModule, viderModulesVerifies } from "@/lib/organization/modules-verifies";

afterEach(() => {
  isModuleEnabled.mockReset();
  viderModulesVerifies();
});

describe("moduleActif (API colis)", () => {
  it("réutilise le résultat que garderApi vient de mémoriser : aucune lecture de plus", async () => {
    memoriserModule("org-1", "route_optimizer", true);
    expect(await moduleActif({} as never, "org-1")).toBe(true);
    expect(isModuleEnabled).not.toHaveBeenCalled();
  });
  it("un module refusé par la garde reste refusé", async () => {
    memoriserModule("org-1", "route_optimizer", false);
    expect(await moduleActif({} as never, "org-1")).toBe(false);
    expect(isModuleEnabled).not.toHaveBeenCalled();
  });
  it("sans résultat mémorisé : relit la base une fois, puis mémorise", async () => {
    isModuleEnabled.mockResolvedValue(true);
    expect(await moduleActif({} as never, "org-9")).toBe(true);
    expect(await moduleActif({} as never, "org-9")).toBe(true);
    expect(isModuleEnabled).toHaveBeenCalledTimes(1);
    expect(isModuleEnabled).toHaveBeenCalledWith({}, "org-9", "route_optimizer");
  });
});
