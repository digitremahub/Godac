import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  employee_id: z.string().uuid(),
  reason: z.string().min(1),
  scheduled_at: z.string().datetime().optional(),
  location: z.string().optional(),
});

/** Direction/chefs d'équipe summoning an employee — RLS ("convocations: manager-like manages") backs the role check. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Seuls les gestionnaires peuvent convoquer un salarié." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("convocations")
    .insert({
      organization_id: appUser.organization_id,
      employee_id: parsed.data.employee_id,
      convened_by: appUser.id,
      reason: parsed.data.reason,
      scheduled_at: parsed.data.scheduled_at ?? null,
      location: parsed.data.location ?? null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
