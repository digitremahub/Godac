import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));

import { regleEffective, refusPour } from "@/lib/acces/garde-api";
import { MODULES_AVEC_CODE, TOUS_LES_ROLES } from "@/lib/acces/catalogue";
import { ECRAN_EXPORT } from "@/lib/exploitation/export";

/**
 * Matrice des droits par route du lot 1 « exploitation » et de sa suite
 * (audit des rôles) : qui obtient quoi, modules actifs. Un refus de rôle
 * est 403 ; la garde de chaque route est lue dans son source.
 */
const tout = new Set<string>(MODULES_AVEC_CODE);
const autorise = (opts: Parameters<typeof regleEffective>[0], role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout, conduit = role === "chauffeur") => refusPour(regleEffective(opts), role, modules, conduit) === null;
const rolesOk = (opts: Parameters<typeof regleEffective>[0]) => TOUS_LES_ROLES.filter((r) => autorise(opts, r));

describe("droits par route", () => {
  it("/api/suivi : direction, exploitation, manager (module Tournée colis)", () => {
    const opts = { roles: ["direction", "manager", "exploitation"] as const, modules: ["route_optimizer"] as const };
    expect(rolesOk(opts).sort()).toEqual(["direction", "exploitation", "manager"]);
    expect(autorise(opts, "direction", new Set())).toBe(false);
  });
  it("/api/a-traiter/lot : encadrement seulement (écran « À traiter »)", () => {
    expect(rolesOk({ ecran: "dashboard.a_traiter" }).sort()).toEqual(["direction", "exploitation", "manager"]);
  });
  it("/api/exploitation/export : historique = chauffeur compris, suivi = encadrement ; jamais le comptable", () => {
    expect(rolesOk({ ecran: ECRAN_EXPORT.historique }).sort()).toEqual(["chauffeur", "direction", "exploitation", "manager"]);
    expect(rolesOk({ ecran: ECRAN_EXPORT.suivi }).sort()).toEqual(["direction", "exploitation", "manager"]);
  });
  it("pages en cours et clôture : encadrement ; chauffeur et comptable refusés", () => {
    for (const ecran of ["exploitation.en_cours", "exploitation.cloture", "exploitation.suivi"]) expect(rolesOk({ ecran }).sort(), ecran).toEqual(["direction", "exploitation", "manager"]);
  });
  it("la paie reste à la direction et au comptable", () => {
    expect(rolesOk({ ecran: "equipe.paie" }).sort()).toEqual(["comptable", "direction"]);
  });
});

describe("gardes serveur présentes dans les routes", () => {
  const lire = (f: string) => readFileSync(f, "utf8");
  it("chaque route du lot appelle garderApi", () => {
    for (const f of ["app/api/suivi/route.ts", "app/api/a-traiter/lot/route.ts", "app/api/exploitation/export/route.ts", "app/api/recherche/route.ts", "app/api/alerts/[id]/route.ts", "app/api/notifications/route.ts"]) {
      expect(lire(f), f).toContain("garderApi(");
    }
  });
  it("le cron exige le secret et borne par organisation", () => {
    const cron = lire("app/api/cron/surveillance-tournees/route.ts");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("unauthorized");
    const surv = lire("lib/exploitation/surveillance-serveur.ts");
    expect(surv.match(/\.eq\("organization_id", organizationId\)/g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("le webhook d'alertes exige son secret", () => {
    expect(lire("app/api/webhooks/supabase-alerts/route.ts")).toContain("x-webhook-secret");
  });
  it("la migration de l'audit restreint les alertes de tournée au comptable et aux managers", () => {
    const sql = lire("supabase/migrations/20261107000001_audit_roles_lot1.sql");
    expect(sql).toContain("revoke execute on function public.accueil_direction_agregats");
    expect(sql).toMatch(/comptable[\s\S]*tournee_sans_chauffeur/);
  });
});
