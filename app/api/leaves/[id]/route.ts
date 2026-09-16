import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  status: z.enum(["approved", "rejected"]),
});

/**
 * Manager-like decision on a leave request. RLS ("leave: manager-like
 * decides within service") already scopes this to the decider's own
 * service(s) — the role check here just gives a clearer error.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    return NextResponse.json({ error: "Rôle non autorisé pour décider d'une demande de congé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .update({ status: parsed.data.status, decided_by: appUser.id, decided_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leaveRequest: data });
}
