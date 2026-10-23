import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { garderDecision } from "@/lib/hierarchie/serveur";

const bodySchema = z.object({ replacement_driver_id: z.string().uuid().nullable() });

/** Assigning who covers an approved leave — direction's own "planning congés", separate from the work planning. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["leave_management"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Seuls les gestionnaires peuvent assigner un remplaçant." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: conge } = await supabase.from("leave_requests").select("driver_id").eq("id", id).maybeSingle();
  if (conge) {
    // Hiérarchie : on n'organise pas le remplacement de son propre congé.
    const garde = await garderDecision(supabase, appUser, conge.driver_id);
    if (!garde.ok) return garde.reponse;
  }
  const { error } = await supabase
    .from("leave_requests")
    .update({ replacement_driver_id: parsed.data.replacement_driver_id })
    .eq("id", id)
    .eq("status", "approved");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
