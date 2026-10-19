import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { consommer } from "@/lib/usage/consommer";
import { fetchVehicleAiSpecs } from "@/lib/vehicles/ai-specs";

const bodySchema = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  gearbox: z.string().optional(),
});

const RATE_LIMIT_PER_HOUR = 30;

/**
 * Lot A: "Compléter par IA" on the vehicle form. Never writes
 * anything — the form reviews/corrects before the normal
 * POST/PATCH /api/vehicles call persists it (see those routes'
 * `spec_sources` handling). Registration is deliberately not part of
 * the request body: it carries no signal for these fields.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: ["direction", "manager", "manager_chauffeur"], modules: ["fleet"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("ai_spec_requests")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", appUser.organization_id)
    .gte("created_at", oneHourAgo);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
    return NextResponse.json(
      { error: `Limite de ${RATE_LIMIT_PER_HOUR} estimations IA par heure atteinte pour votre organisation. Réessayez plus tard.` },
      { status: 429 },
    );
  }

  const quota = await consommer(createAdminSupabaseClient(), appUser.organization_id, appUser.id, "vehicle_ai_specs");
  if (!quota.ok) {
    return NextResponse.json({ error: quota.raison }, { status: 429 });
  }

  const result = await fetchVehicleAiSpecs(parsed.data);

  // Logged regardless of outcome — it's a call made, not a call that succeeded.
  await supabase.from("ai_spec_requests").insert({ organization_id: appUser.organization_id, user_id: appUser.id });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  return NextResponse.json({ specs: result.specs });
}
