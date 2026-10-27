import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const utilisateur = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: () => utilisateur() }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
const modules = vi.fn();
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: () => modules() }));
const offre = vi.fn();
vi.mock("@/lib/go-navigation/etat", () => ({ lireEtatOffre: () => offre() }));
const OFFRE_CLASSIQUE = { goNavigation: false, essaiTermine: false, trialEndsAt: null, country: "FR" };

import { garderApi, regleEffective, refusPour } from "@/lib/acces/garde-api";
import { moduleDejaVerifie, viderModulesVerifies } from "@/lib/organization/modules-verifies";

const u = (role: string, conduit = role === "chauffeur") => ({ id: "u1", organization_id: "o1", role, full_name: "X", email: "x@y", active: true, pending_approval: false, can_drive: conduit, conduit });

beforeEach(() => {
  utilisateur.mockReset();
  modules.mockReset();
  offre.mockReset();
  offre.mockResolvedValue(OFFRE_CLASSIQUE);
  viderModulesVerifies();
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

  it("offre illisible (incident base) et module refusé : 503 passager, pas « module désactivé »", async () => {
    utilisateur.mockResolvedValue(u("direction"));
    modules.mockResolvedValue([]);
    offre.mockResolvedValue({ ...OFFRE_CLASSIQUE, indetermine: true });
    const r = await garderApi({ roles: ["direction"], modules: ["planning"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reponse.status).toBe(503);
  });

  it("mémorise les modules vérifiés pour le second contrôle de la même requête (moduleActif)", async () => {
    utilisateur.mockResolvedValue(u("direction"));
    modules.mockResolvedValue(["route_optimizer"]);
    const r = await garderApi({ modules: ["route_optimizer", "planning"] });
    expect(r.ok).toBe(false);
    expect(moduleDejaVerifie("o1", "route_optimizer")).toBe(true);
    expect(moduleDejaVerifie("o1", "planning")).toBe(false);
    expect(moduleDejaVerifie("o2", "route_optimizer")).toBeNull();
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
