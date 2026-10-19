import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  type: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  status: z.enum(["scheduled", "in_progress", "done", "cancelled"]).optional(),
  completed_at: z.string().datetime().nullable().optional(),
  cost: z.coerce.number().nonnegative().nullable().optional(),
  odometer_km: z.coerce.number().min(0).nullable().optional(),
  odometer_photo_path: z.string().nullable().optional(),
});

/**
 * Editing an existing request/intervention (type, description,
 * urgency, schedule, cost) as well as advancing its status — RLS
 * ("interventions: manager-like write scoped to service") restricts
 * this to manager-like/direction, the requester themselves cannot
 * edit it once opened (only the manager handling it can).
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["maintenance_requests"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour modifier une demande d'entretien" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicle_interventions")
    .update(parsed.data)
    .eq("id", id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intervention: data });
}
