import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  type: z.string().min(1),
  description: z.string().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  scheduled_at: z.string().datetime().optional(),
  cost: z.coerce.number().nonnegative().optional(),
});

/**
 * "Demandes d'Entretien" (module maintenance_requests): any org
 * member can open a request naming themselves as requester — RLS
 * ("interventions: any member requests") is the real gate, allowing
 * this alongside manager-like's full write access.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("vehicle_interventions")
    .insert({ organization_id: appUser.organization_id, requested_by: appUser.id, ...parsed.data })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ intervention: data });
}
