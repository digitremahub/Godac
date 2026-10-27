import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getCurrentAppUser: async () => null }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/organization/modules", () => ({ getEnabledModuleKeys: async () => [] }));

import { regleEffective, refusPour } from "@/lib/acces/garde-api";
import { MODULES_AVEC_CODE, TOUS_LES_ROLES } from "@/lib/acces/catalogue";
import { ROLES_CORRECTION_PLEIN } from "@/lib/ticpe/corrections";
import { ROLES_EXPORT_PLEINS } from "@/lib/fuel/export";
import { peutJoindreTicket } from "@/lib/fuel/justificatif";
import { droitsEcart } from "@/lib/fuel/ecarts";
import { alerteVisiblePour } from "@/lib/alerts/destinataires";
import { ROLES_A_TRAITER, TYPES_A_TRAITER, TYPES_MANAGER, typeVisiblePour } from "@/lib/a-traiter/logique";

/**
 * Matrice rôle × route du lot 2 « carburant / TICPE / flotte » : qui obtient
 * quoi, modules actifs. Un refus de rôle est 403 ; la garde de chaque route est
 * relue dans son source pour qu'une route ne s'ouvre pas sans que ce test le dise.
 */
const tout = new Set<string>(MODULES_AVEC_CODE);
const autorise = (opts: Parameters<typeof regleEffective>[0], role: (typeof TOUS_LES_ROLES)[number], modules: ReadonlySet<string> = tout, conduit = role === "chauffeur") => refusPour(regleEffective(opts), role, modules, conduit) === null;
const rolesOk = (opts: Parameters<typeof regleEffective>[0]) => TOUS_LES_ROLES.filter((r) => autorise(opts, r)).sort();
const lire = (f: string) => readFileSync(f, "utf8");

describe("droits par route", () => {
  it("POST/PATCH /api/fuel-entries, /ticket, /contexte : tout membre ; le périmètre est fait par la RLS et par les droits du plein", () => {
    expect(rolesOk({ roles: "tous" })).toEqual(["chauffeur", "comptable", "direction", "exploitation", "manager"]);
  });

  it("/api/fuel-entries/[id]/ticket : le chauffeur son plein, l'encadrement et le comptable la correction", () => {
    const plein = { driver_id: "c1", created_by: "c1", occurred_at: new Date().toISOString(), ticket_photo_path: null };
    const peut = (role: string, userId: string) => peutJoindreTicket({ role, userId, plein });
    expect(peut("chauffeur", "c1")).toBe(true);
    expect(peut("chauffeur", "c2")).toBe(false);
    for (const role of ["manager", "exploitation", "direction", "comptable"]) expect(peut(role, "autre"), role).toBe(true);
  });

  it("/api/fuel-entries/[id]/justificatif|zone|doublon : encadrement + comptable, module Export TICPE ; jamais le chauffeur", () => {
    const opts = { roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] as const };
    expect(rolesOk(opts)).toEqual(["comptable", "direction", "exploitation", "manager"]);
    expect(autorise(opts, "comptable", new Set())).toBe(false);
    expect(autorise(opts, "chauffeur")).toBe(false);
  });

  it("/api/ticpe/bloquants/lot : direction, exploitation, comptable (écran « TICPE : à régler »)", () => {
    expect(rolesOk({ ecran: "carburant.ticpe_controles" })).toEqual(["comptable", "direction", "exploitation"]);
    expect(autorise({ ecran: "carburant.ticpe_controles" }, "comptable", new Set())).toBe(false);
  });

  it("/api/fuel-entries/export : comptable, direction, exploitation, manager ; jamais le chauffeur", () => {
    expect(rolesOk({ roles: ROLES_EXPORT_PLEINS })).toEqual(["comptable", "direction", "exploitation", "manager"]);
  });
});

describe("le comptable ne reçoit pas la validation hiérarchique", () => {
  it("il ne traite aucun écart carburant, quel que soit le plein", () => {
    for (const driverId of ["c1", "m1", null]) {
      const d = droitsEcart({ role: "comptable", userId: "compta-1", driverId, statut: "ouvert", roleChauffeur: driverId === "m1" ? "manager" : "chauffeur", directionCount: 2 });
      expect(d.traiter, String(driverId)).toBe(false);
    }
  });
  it("il n'a ni « À traiter » ni aucun de ses types", () => {
    expect(ROLES_A_TRAITER).not.toContain("comptable");
    for (const t of TYPES_A_TRAITER) expect(typeVisiblePour(t, "comptable"), t).toBe(false);
  });
  it("la route d'écart reste fermée à ses corrections TICPE : elle applique la hiérarchie des demandes", () => {
    const route = lire("app/api/fuel-entries/[id]/ecart/route.ts");
    expect(route).toContain("droitsEcart(");
    expect(route).not.toContain("ROLES_CORRECTION_PLEIN");
  });
});

describe("échéances de la flotte (« À traiter » et alertes)", () => {
  it("À traiter : manager (ses véhicules), exploitation, direction ; jamais le comptable ni le chauffeur", () => {
    expect(TYPES_MANAGER).toContain("echeance_vehicule");
    for (const role of ["manager", "exploitation", "direction"]) expect(typeVisiblePour("echeance_vehicule", role), role).toBe(true);
    for (const role of ["comptable", "chauffeur"]) expect(typeVisiblePour("echeance_vehicule", role), role).toBe(false);
  });
  it("alerte : un manager ne reçoit que les véhicules de son service, un véhicule sans service reste à l'exploitation et à la direction", () => {
    expect(alerteVisiblePour("manager", "echeance_vehicule", "s1", ["s1"])).toBe(true);
    expect(alerteVisiblePour("manager", "echeance_vehicule", "s2", ["s1"])).toBe(false);
    expect(alerteVisiblePour("manager", "echeance_vehicule", null, ["s1"])).toBe(false);
    for (const role of ["exploitation", "direction"]) expect(alerteVisiblePour(role, "echeance_vehicule", null, []), role).toBe(true);
    for (const role of ["comptable", "chauffeur"]) expect(alerteVisiblePour(role, "echeance_vehicule", "s1", ["s1"]), role).toBe(false);
  });
});

describe("gardes serveur présentes dans les routes", () => {
  it("chaque route nouvelle ou modifiée appelle garderApi avec le bon périmètre", () => {
    const attendu: Record<string, string> = {
      "app/api/fuel-entries/route.ts": 'garderApi({ roles: "tous" })',
      "app/api/fuel-entries/[id]/route.ts": 'garderApi({ roles: "tous" })',
      "app/api/fuel-entries/[id]/ticket/route.ts": 'garderApi({ roles: "tous" })',
      "app/api/fuel-entries/contexte/route.ts": 'garderApi({ roles: "tous" })',
      "app/api/fuel-entries/[id]/justificatif/route.ts": 'garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] })',
      "app/api/fuel-entries/[id]/zone/route.ts": 'garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] })',
      "app/api/fuel-entries/[id]/doublon/route.ts": 'garderApi({ roles: ROLES_CORRECTION_PLEIN, modules: ["ticpe_export"] })',
      "app/api/ticpe/bloquants/lot/route.ts": 'garderApi({ ecran: "carburant.ticpe_controles" })',
      "app/api/fuel-entries/export/route.ts": "garderApi({ roles: ROLES_EXPORT_PLEINS })",
    };
    for (const [f, garde] of Object.entries(attendu)) expect(lire(f), f).toContain(garde);
  });
  it("le comptable écrit par le client service, borné à son organisation, et seulement des colonnes TICPE", () => {
    const src = lire("lib/ticpe/corrections-serveur.ts");
    expect(src).toContain("createAdminSupabaseClient()");
    expect((src.match(/\.eq\("organization_id", (?:ctx\.)?appUser\.organization_id\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
    for (const interdit of ["liters", "unit_price", "total_amount", "validated_by", "validated_at"]) expect(src.includes(interdit), interdit).toBe(false);
    // Aucune écriture du statut du plein (la validation reste hiérarchique).
    expect(/\.update\([^)]*\bstatus\b/.test(src)).toBe(false);
  });
  it("la route du ticket vérifie le chemin, le type et la taille avant d'écrire, dans le dossier de l'organisation", () => {
    const src = lire("app/api/fuel-entries/[id]/ticket/route.ts");
    expect(src).toContain("cheminTicketValide(");
    expect(src).toContain("verifierFichierTicket(");
    expect(src).toContain("peutJoindreTicket(");
    expect(src).toContain('.eq("organization_id", appUser.organization_id)');
  });
  it("le lot et l'export sont journalisés", () => {
    expect(lire("app/api/ticpe/bloquants/lot/route.ts")).toContain('action: "plein_correction_lot"');
    expect(lire("app/api/fuel-entries/export/route.ts")).toContain('action: "export_pleins"');
  });
  it("le cron des échéances exige CRON_SECRET et borne chaque lecture par organisation", () => {
    const cron = lire("app/api/cron/echeances-flotte/route.ts");
    expect(cron).toContain("CRON_SECRET");
    expect(cron).toContain("unauthorized");
    const serveur = lire("lib/alerts/echeances-serveur.ts");
    expect((serveur.match(/\.eq\("organization_id", organizationId\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("vercel.json : plan Hobby, aucun cron plus fréquent qu'une fois par jour", () => {
  const crons = JSON.parse(lire("vercel.json")).crons as { path: string; schedule: string }[];
  it("chaque cron est quotidien ou plus espacé (minute et heure fixes)", () => {
    expect(crons.length).toBeGreaterThan(0);
    for (const c of crons) {
      const [minute, heure] = c.schedule.split(/\s+/);
      expect(c.schedule.split(/\s+/), c.path).toHaveLength(5);
      expect(minute, `${c.path} : minute`).toMatch(/^\d{1,2}$/);
      expect(heure, `${c.path} : heure`).toMatch(/^\d{1,2}$/);
    }
  });
  it("le cron des échéances de la flotte y figure, une fois par jour", () => {
    const c = crons.find((x) => x.path === "/api/cron/echeances-flotte");
    expect(c).toBeDefined();
    expect(c!.schedule).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });
});

describe("migrations additives, rejouables, non appliquées à la création", () => {
  it("type d'alerte, clé de dédoublonnage et colonnes du lot", () => {
    const enumSql = lire("supabase/migrations/20261108000001_alerte_echeances_vehicule.sql");
    expect(enumSql).toContain("add value if not exists 'echeance_vehicule'");
    const unique = lire("supabase/migrations/20261108000002_alerte_echeances_vehicule_unique.sql");
    expect(unique).toContain("add column if not exists cle_dedoublonnage");
    expect(unique).toContain("create unique index if not exists alerts_cle_dedoublonnage_unique");
    // Le comptable ne lit pas les échéances de la flotte, un manager seulement celles de son service.
    expect(unique).toMatch(/comptable[\s\S]*echeance_vehicule/);
    const lot = lire("supabase/migrations/20261108000003_carburant_lot2.sql");
    expect(lot).toContain("add column if not exists controle_confirme jsonb");
    expect(lot).toContain("add column if not exists closed_at");
    for (const f of [enumSql, unique, lot]) expect(/drop (table|column)|delete from|truncate/i.test(f), "pas destructif").toBe(false);
  });
});
