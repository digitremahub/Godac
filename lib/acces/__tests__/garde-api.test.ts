import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const utilisateur = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: () => utilisateur() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
const modules = vi.fn();
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: () => modules() }));

import { garderApi, regleEffective, refusPour } from "@/lib/acces/garde-api";

const u = (role: string, conduit = role === "chauffeur") => ({ id: "u1", organization_id: "o1", role, full_name: "X", email: "x@y", active: true, pending_approval: false, can_drive: conduit, conduit });

beforeEach(() => {
  utilisateur.mockReset();
  modules.mockReset();
});

describe("garderApi", () => {
  it("401 sans session", async () => {
    utilisateur.mockResolvedValue(null);
    const r = await garderApi({ roles: "tous" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reponse.status).toBe(401);
      expect(await r.reponse.json()).toMatchObject({ code: "NON_CONNECTE" });
    }
  });

  it("403 ROLE_REFUSE avec la liste des rôles, message en chaîne", async () => {
    utilisateur.mockResolvedValue(u("chauffeur"));
    const r = await garderApi({ ecran: "carburant.ticpe" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const json = await r.reponse.json();
      expect(r.reponse.status).toBe(403);
      expect(json).toMatchObject({ code: "ROLE_REFUSE", rolesAutorises: ["direction", "exploitation", "comptable"] });
      expect(typeof json.error).toBe("string");
    }
    expect(modules).not.toHaveBeenCalled();
  });

  it("403 MODULE_INACTIF quand le module de l'écran est coupé", async () => {
    utilisateur.mockResolvedValue(u("comptable"));
    modules.mockResolvedValue(["fleet"]);
    const r = await garderApi({ ecran: "carburant.ticpe" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await r.reponse.json()).toMatchObject({ code: "MODULE_INACTIF", module: "ticpe_export" });
  });

  it("accès accordé : renvoie utilisateur et modules", async () => {
    utilisateur.mockResolvedValue(u("direction"));
    modules.mockResolvedValue(["planning"]);
    const r = await garderApi({ roles: ["direction"], modules: ["planning"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.modules.has("planning")).toBe(true);
  });

  it("sans exigence de module, aucune lecture des modules", async () => {
    utilisateur.mockResolvedValue(u("manager"));
    const r = await garderApi({ roles: ["manager"] });
    expect(r.ok).toBe(true);
    expect(modules).not.toHaveBeenCalled();
  });
});

describe("règle effective", () => {
  it("les options s'ajoutent à l'écran ; roles prioritaires", () => {
    const r = regleEffective({ ecran: "flotte.amendes", modules: ["ocr"], roles: ["direction"] });
    expect(r.roles).toEqual(["direction"]);
    expect(r.modules).toEqual(["fines", "ocr"]);
    expect(refusPour(r, "manager", new Set(["fines", "ocr"]))?.status).toBe(403);
    expect(refusPour(r, "direction", new Set(["fines", "ocr"]))).toBeNull();
  });
  it("sans écran ni rôles : tout membre", () => {
    expect(regleEffective({}).roles).toHaveLength(5);
  });
});

describe("écrans de conduite côté API", () => {
  it("manager sans « conduit aussi » refusé, manager qui conduit accepté", async () => {
    utilisateur.mockResolvedValue(u("manager"));
    modules.mockResolvedValue(["planning"]);
    const r = await garderApi({ ecran: "moi.tournee_depart" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(await r.reponse.json()).toMatchObject({ code: "ROLE_REFUSE" });
    utilisateur.mockResolvedValue(u("manager", true));
    expect((await garderApi({ ecran: "moi.tournee_depart" })).ok).toBe(true);
  });
});
