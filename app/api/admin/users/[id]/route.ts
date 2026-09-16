import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/clerk/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { updateOrganizationMemberRole } from "@/lib/clerk/invitations";

const bodySchema = z.object({
  role: z.enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"]).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const { orgId } = await auth();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut modifier les rôles" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const { data: targetUser, error } = await supabase
    .from("users")
    .update(parsed.data)
    .eq("id", id)
    .select("id, clerk_user_id, role")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (parsed.data.role && orgId) {
    try {
      await updateOrganizationMemberRole({ clerkOrgId: orgId, clerkUserId: targetUser.clerk_user_id, role: parsed.data.role });
    } catch (err) {
      console.error("Failed to sync role back to Clerk metadata", err);
    }
  }

  return NextResponse.json({ user: targetUser });
}
