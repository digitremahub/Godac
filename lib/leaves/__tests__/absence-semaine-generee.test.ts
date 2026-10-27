import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({}) }));

import { signalerAbsenceSemaineGeneree } from "@/lib/leaves/planning-serveur";
import { parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { fakeDb } from "@/lib/planning/__tests__/_fake-db";

const at = (date: string, heure: string) => parisWallTimeToUtcISOString(date, heure);
const suivi = (p: Record<string, unknown> = {}) => ({ id: "l1", organization_id: "o1", service_id: "s1", semaine_debut: "2026-11-09", publie_at: null, confirme_at: null, modifie_at: null, resume: {}, ...p });
const params = { organizationId: "o1", driverId: "d1", nom: "Dupont", du: "2026-11-10", au: "2026-11-12", affectations: [{ id: "e1", service_id: "s1", start_at: at("2026-11-10", "07:00") }, { id: "e2", service_id: "s1", start_at: at("2026-11-11", "07:00") }] };

describe("congé approuvé après la génération du planning de la semaine suivante", () => {
  it("signale à l'encadrement du service (direction, exploitation, managers du service) : une alerte par service et par semaine, sans motif", async () => {
    const db = fakeDb({ planning_semaines_auto: [suivi()], alerts: [] });
    expect(await signalerAbsenceSemaineGeneree(db as any, params)).toBe(1);
    const a = db.ligne("alerts")[0]!;
    expect(a).toMatchObject({ type: "planning_conflict", severity: "warning", service_id: "s1", recipient_roles: ["manager", "exploitation", "direction"], related_table: "planning_entries", related_id: "e1" });
    expect(a.message).toContain("Dupont en congé du 10/11 au 12/11");
    expect(a.message).toContain("2 tournées sont à remplacer");
    expect(a.recipient_user_id).toBeUndefined();
    // Même congé signalé deux fois : une seule alerte (clé de dédoublonnage).
    expect(await signalerAbsenceSemaineGeneree(db as any, params)).toBe(0);
    expect(db.ligne("alerts")).toHaveLength(1);
  });

  it("rien si la semaine n'est pas suivie, déjà confirmée ou publiée, ou sans la migration", async () => {
    expect(await signalerAbsenceSemaineGeneree(fakeDb({ planning_semaines_auto: [], alerts: [] }) as any, params)).toBe(0);
    expect(await signalerAbsenceSemaineGeneree(fakeDb({ planning_semaines_auto: [suivi({ publie_at: "2026-11-06T16:00:00Z" })], alerts: [] }) as any, params)).toBe(0);
    expect(await signalerAbsenceSemaineGeneree(fakeDb({ planning_semaines_auto: [suivi({ confirme_at: "2026-11-06T10:00:00Z" })], alerts: [] }) as any, params)).toBe(0);
    expect(await signalerAbsenceSemaineGeneree(fakeDb({ alerts: [] }) as any, params)).toBe(0);
  });

  it("l'approbation d'un congé appelle ce signalement", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("app/api/leaves/[id]/route.ts", "utf8")).toContain("signalerAbsenceSemaineGeneree(");
  });
});
