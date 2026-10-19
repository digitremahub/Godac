import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { deciderAjout, etatLimite, type EtatLimite } from "@/lib/acces/limites";

export interface LimiteVehicules extends EtatLimite {
  formule: string | null;
  nomFormule: string | null;
}

/**
 * Véhicules de l'organisation (toute la flotte, pas seulement le service
 * visible par un manager : compte fait avec le client admin) face au
 * `plans.vehicle_max` de sa formule.
 */
export async function limiteVehicules(organizationId: string, admin: SupabaseClient = createAdminSupabaseClient()): Promise<LimiteVehicules> {
  const { data: org } = await admin.from("organizations").select("plan").eq("id", organizationId).maybeSingle();
  const formule = (org?.plan as string | undefined) ?? null;
  const [{ data: plan }, { count }] = await Promise.all([
    formule ? admin.from("plans").select("name, vehicle_max").eq("id", formule).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("vehicles").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const max = (plan as { vehicle_max: number | null } | null)?.vehicle_max ?? null;
  return { ...etatLimite(count ?? 0, max), formule, nomFormule: (plan as { name?: string } | null)?.name ?? formule };
}

/**
 * Contrôle avant d'ajouter des véhicules (POST /api/vehicles, imports).
 * `immatriculations` : les véhicules déjà présents (même immatriculation)
 * ne comptent pas comme ajout. Renvoie l'avertissement éventuel, ou le
 * message de refus (402 LIMITE_FORMULE côté route).
 */
export async function controlerAjoutVehicules(
  organizationId: string,
  immatriculations: string[],
): Promise<{ ok: true; avertissement: string | null; limite: LimiteVehicules } | { ok: false; message: string; limite: LimiteVehicules }> {
  const admin = createAdminSupabaseClient();
  const limite = await limiteVehicules(organizationId, admin);
  const normal = (r: string) => r.replace(/[\s-]/g, "").toUpperCase();
  const demandees = [...new Set(immatriculations.map(normal).filter(Boolean))];
  let ajout = demandees.length;
  if (ajout > 0 && limite.inclus !== null) {
    const { data: existants } = await admin.from("vehicles").select("registration").eq("organization_id", organizationId);
    const deja = new Set((existants ?? []).map((v) => normal(String(v.registration ?? ""))));
    ajout = demandees.filter((r) => !deja.has(r)).length;
  }
  const d = deciderAjout({ utilise: limite.utilise, inclus: limite.inclus, ajout, formule: limite.nomFormule ?? undefined });
  return d.ok ? { ok: true, avertissement: d.avertissement, limite } : { ok: false, message: d.message, limite };
}
