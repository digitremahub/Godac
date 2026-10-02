import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";

const bodySchema = z.object({ status: z.enum(["in_progress", "resolved"]), response: z.string().min(1).optional() });

/** GODAC staff resolving a request routed to them (recipient = 'support_godac') — cross-tenant, same allowlist gate as the rest of app/godac-staff. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const updateFields: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.response !== undefined) updateFields.responded_at = new Date().toISOString();

  const { data: updated, error } = await admin
    .from("support_requests")
    .update(updateFields)
    .eq("id", id)
    .eq("recipient", "support_godac")
    .select("conversation_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (parsed.data.response !== undefined && updated.conversation_id) {
    await admin.from("assistant_messages").insert({
      conversation_id: updated.conversation_id,
      role: "assistant",
      content: parsed.data.response,
      needs_human: false,
    });
  }

  return NextResponse.json({ ok: true });
}
