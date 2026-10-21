import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
  response: z.string().min(1).optional(),
});

/**
 * Manager-like action on a support request (take it / respond /
 * resolve) — RLS ("support_requests: manager-like updates") is the
 * real backstop, this role check just gives an immediate, clear error
 * instead of a silent no-op update.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "exploitation", "direction"])) {
    return NextResponse.json({ error: "Seuls les gestionnaires peuvent traiter une demande d'assistance." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const updateFields: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.response !== undefined) {
    updateFields.responded_at = new Date().toISOString();
    updateFields.assigned_to = appUser.id;
  }

  const { data: updated, error } = await supabase
    .from("support_requests")
    .update(updateFields)
    .eq("id", id)
    .select("conversation_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The response also needs to land back in the requester's own
  // assistant window — their RLS-scoped session can't write there
  // (nor should a manager be granted that broadly), so this one
  // insert goes through the admin client, same trust model as
  // lib/auth/driver-pin.ts: the condition (this manager just resolved
  // THIS org's request, already confirmed by the update above
  // succeeding under RLS) is checked before reaching for it.
  if (parsed.data.response !== undefined && updated.conversation_id) {
    const admin = createAdminSupabaseClient();
    await admin.from("assistant_messages").insert({
      conversation_id: updated.conversation_id,
      role: "assistant",
      content: parsed.data.response,
      needs_human: false,
    });
    await admin.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", updated.conversation_id);
  }

  return NextResponse.json({ ok: true });
}
