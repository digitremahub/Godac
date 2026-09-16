import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ name: z.string().min(1) });

/**
 * Onboarding step 1 for an organic sign-up (as opposed to an invited
 * member, who is auto-provisioned by lib/auth/provisioning.ts and
 * never sees this form): creates the tenant and makes the signed-in
 * user its `direction`.
 *
 * Uses the service-role client deliberately — creating a brand new
 * organisation is inherently a privileged bootstrap action with no
 * existing row for RLS to scope against yet. Safety comes from the
 * explicit "does this user already have a profile" check below, not
 * from RLS.
 */
export async function POST(req: Request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();

  const { data: existingProfile } = await admin.from("users").select("id").eq("id", user.id).maybeSingle();
  if (existingProfile) {
    return NextResponse.json({ error: "Vous appartenez déjà à une organisation GODAC." }, { status: 409 });
  }

  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .insert({ name: parsed.data.name })
    .select("id")
    .single();
  if (orgError) {
    return NextResponse.json({ error: orgError.message }, { status: 500 });
  }

  const { error: userError } = await admin.from("users").insert({
    id: user.id,
    organization_id: organization.id,
    role: "direction",
    full_name: (user.user_metadata?.full_name as string) ?? user.email ?? "Direction",
    email: user.email!,
  });
  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  return NextResponse.json({ organizationId: organization.id });
}
