import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { garderDecision } from "@/lib/hierarchie/serveur";

const bodySchema = z.object({
  employee_id: z.string().uuid(),
  reason: z.string().min(1),
  scheduled_at: z.string().datetime().optional(),
  location: z.string().optional(),
});

/** Direction/chefs d'équipe summoning an employee — RLS ("convocations: manager-like manages") backs the role check. */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["intranet"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Seuls les gestionnaires peuvent convoquer un salarié." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  // Hiérarchie : on ne se convoque pas soi-même, ni un pair ou un supérieur (la direction : une autre personne de la direction).
  const garde = await garderDecision(supabase, appUser, parsed.data.employee_id);
  if (!garde.ok) return garde.reponse;
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
