import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "comptable", "direction"]).optional(),
  active: z.boolean().optional(),
});

/**
 * The one place in GODAC that can change any user's role or
 * deactivate a *last remaining* direction account — both blocked by
 * design in app/api/admin/users/[id] (a client org must always keep
 * at least one working direction account, or nobody could undo a
 * mistake from their own UI). This is the intentional "break glass"
 * override for support cases (lost access, offboarding, account
 * takeover) — gated by GODAC_STAFF_EMAILS rather than any org role,
 * same as app/godac-staff/page.tsx, and runs on the service-role
 * client since staff has no membership in the target organisation for
 * RLS to recognise.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) {
    return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Rien à modifier" }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("users")
    .update(parsed.data)
    .eq("id", id)
    .select("id, organization_id, role, active")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ user: data });
}
