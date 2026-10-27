import { afterEach, describe, expect, it } from "vitest";
import { VALIDITE_MODULE_VERIFIE_MS, memoriserModule, moduleDejaVerifie, viderModulesVerifies } from "@/lib/organization/modules-verifies";

afterEach(() => viderModulesVerifies());

describe("modules déjà vérifiés par la garde", () => {
  it("rien en mémoire : il faut relire la base", () => {
    expect(moduleDejaVerifie("org-1", "route_optimizer", 1000)).toBeNull();
  });
  it("réutilise le résultat quelques secondes, actif ou non", () => {
    memoriserModule("org-1", "route_optimizer", true, 1000);
    memoriserModule("org-2", "route_optimizer", false, 1000);
    expect(moduleDejaVerifie("org-1", "route_optimizer", 1000 + VALIDITE_MODULE_VERIFIE_MS - 1)).toBe(true);
    expect(moduleDejaVerifie("org-2", "route_optimizer", 1500)).toBe(false);
  });
  it("expire", () => {
    memoriserModule("org-1", "route_optimizer", true, 1000);
    expect(moduleDejaVerifie("org-1", "route_optimizer", 1000 + VALIDITE_MODULE_VERIFIE_MS)).toBeNull();
  });
  it("ne mélange ni les organisations ni les modules", () => {
    memoriserModule("org-1", "route_optimizer", true, 1000);
    expect(moduleDejaVerifie("org-2", "route_optimizer", 1001)).toBeNull();
    expect(moduleDejaVerifie("org-1", "time_clock", 1001)).toBeNull();
  });
});
