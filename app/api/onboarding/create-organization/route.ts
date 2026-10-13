import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PAYS, type CodePays } from "@/lib/pays/pays";
import { getFullCatalog, priceFor } from "@/lib/organization/catalog";

const bodySchema = z.object({
  name: z.string().min(1),
  country: z.enum(PAYS.map((p) => p.code) as [CodePays, ...CodePays[]]).default("FR"),
});

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
    .insert({ name: parsed.data.name, country: parsed.data.country })
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

  // Seed the free/included baseline for the default ("starter", the
  // cheapest *public* plan — see supabase/migrations/20260101000023,
  // Essentiel is request-only) right away, so nav gating
  // (getEnabledModuleKeys) never sees an org with zero rows — even if
  // this user never reaches or completes the module-selection step of
  // onboarding. Step 2 (api/onboarding/modules) upserts over this once
  // it runs.
  const { modules, prices } = await getFullCatalog(admin);
  const baseline = modules
    .filter((m) => m.wave !== "v3")
    .map((m) => {
      const included = priceFor(prices, m.key, "starter")?.included ?? false;
      return {
        organization_id: organization.id,
        module_key: m.key,
        enabled: included,
        pricing_mode: included ? ("included" as const) : ("a_la_carte" as const),
        effective_monthly_price: 0,
      };
    });
  await admin.from("organization_modules").upsert(baseline, { onConflict: "organization_id,module_key" });

  return NextResponse.json({ organizationId: organization.id });
}
