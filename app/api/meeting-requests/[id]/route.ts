import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { garderDecision, tracerAutoValidation } from "@/lib/hierarchie/serveur";

const bodySchema = z.object({
  status: z.enum(["scheduled", "declined", "done"]),
  scheduled_at: z.string().datetime().optional(),
});

/** Only manager-like/direction advance a request's status — RLS ("meeting_requests: manager-like updates") is the real gate. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["intranet"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  // Hiérarchie : on ne traite pas sa propre demande de réunion ; rang supérieur à celui du demandeur.
  const { data: demande } = await supabase.from("meeting_requests").select("requested_by").eq("id", id).maybeSingle();
  if (demande?.requested_by) {
    const garde = await garderDecision(supabase, appUser, demande.requested_by);
    if (!garde.ok) return garde.reponse;
    if (garde.autoValidee) await tracerAutoValidation(appUser, { table: "meeting_requests", id, decision: parsed.data.status });
  }
  const { data, error } = await supabase
    .from("meeting_requests")
    .update({
      status: parsed.data.status,
      scheduled_at: parsed.data.scheduled_at ?? null,
      handled_by: appUser.id,
    })
    .eq("id", id)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  return NextResponse.json({ request: data });
}
