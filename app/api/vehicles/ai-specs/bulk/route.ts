import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { fetchVehicleAiSpecs, AI_SPEC_FIELDS, type SpecSources } from "@/lib/vehicles/ai-specs";

const bodySchema = z.object({
  vehicle_ids: z.array(z.string().uuid()).min(1).max(10),
});

const RATE_LIMIT_PER_HOUR = 30;

/**
 * "Compléter les champs vides par IA" from the fleet import panel —
 * same single-vehicle estimate as POST /api/vehicles/ai-specs, run
 * for several already-created vehicles in one call. Capped at 10
 * vehicles per request (the hourly 30-call org quota is the real
 * limit; this cap just keeps one request inside typical execution
 * limits). Only ever fills a field that is currently empty — never
 * overwrites a value a human or an import already set — and marks
 * every field it does fill as `ia`/unconfirmed in `spec_sources`,
 * exactly like the single-vehicle wizard.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: vehicles, error: fetchError } = await supabase
    .from("vehicles")
    .select(
      "id, brand, model, model_year, gearbox, type, fuel_type, tank_capacity_liters, adblue_capacity_liters, ptac_kg, reference_consumption_l_100km, spec_sources",
    )
    .in("id", parsed.data.vehicle_ids);
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const results: { id: string; updated: string[]; error?: string }[] = [];

  for (const vehicle of vehicles ?? []) {
    if (!vehicle.brand || !vehicle.model) {
      results.push({ id: vehicle.id, updated: [], error: "Marque/modèle manquant — non envoyé à l'IA." });
      continue;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("ai_spec_requests")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", appUser.organization_id)
      .gte("created_at", oneHourAgo);
    if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
      results.push({ id: vehicle.id, updated: [], error: "Limite horaire d'estimations IA atteinte pour votre organisation." });
      break;
    }

    const result = await fetchVehicleAiSpecs({
      brand: vehicle.brand,
      model: vehicle.model,
      year: vehicle.model_year ?? undefined,
      gearbox: vehicle.gearbox ?? undefined,
    });
    await supabase.from("ai_spec_requests").insert({ organization_id: appUser.organization_id, user_id: appUser.id });

    if (!result.ok) {
      results.push({ id: vehicle.id, updated: [], error: result.reason });
      continue;
    }

    const specSources: SpecSources = { ...((vehicle.spec_sources as SpecSources | null) ?? {}) };
    const updateFields: Record<string, unknown> = {};
    const updated: string[] = [];

    for (const field of AI_SPEC_FIELDS) {
      if (vehicle[field as keyof typeof vehicle] !== null && vehicle[field as keyof typeof vehicle] !== undefined) {
        continue; // never overwrite an existing value
      }
      const estimated = result.specs[field].value;
      if (estimated === null) continue;
      updateFields[field] = estimated;
      specSources[field] = { origin: "ia", confirmed: false };
      updated.push(field);
    }

    if (updated.length > 0) {
      const { error: updateError } = await supabase
        .from("vehicles")
        .update({ ...updateFields, spec_sources: specSources })
        .eq("id", vehicle.id);
      if (updateError) {
        results.push({ id: vehicle.id, updated: [], error: updateError.message });
        continue;
      }
    }

    results.push({ id: vehicle.id, updated });
  }

  return NextResponse.json({ results });
}
