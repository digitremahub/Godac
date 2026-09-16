import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getFullCatalog, priceFor, type PlanId } from "@/lib/organization/catalog";

const bodySchema = z.object({
  selectedModuleKeys: z.array(z.string()),
});

/**
 * Post-signup module changes from the billing page (Module 9). Same
 * write pattern as app/api/onboarding/modules/route.ts, but reads the
 * org's current plan rather than changing it — this route only flips
 * which à-la-carte modules are on. It does NOT touch the Stripe
 * subscription amount (see README "Intégrations non branchées":
 * changing modules after signup doesn't yet re-price the existing
 * subscription automatically).
 */
export async function PATCH(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut modifier les modules" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const selected = new Set(parsed.data.selectedModuleKeys);

  const supabase = await createServerSupabaseClient();

  const { data: organization } = await supabase
    .from("organizations")
    .select("plan")
    .eq("id", appUser.organization_id)
    .single();
  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }
  const planId = organization.plan as PlanId;

  const { modules, prices } = await getFullCatalog(supabase);
  const sellable = modules.filter((m) => m.wave !== "v3");

  const rows = sellable.map((m) => {
    const price = priceFor(prices, m.key, planId);
    const included = price?.included ?? false;
    const enabled = included || selected.has(m.key);
    return {
      organization_id: appUser.organization_id,
      module_key: m.key,
      enabled,
      pricing_mode: included ? ("included" as const) : ("a_la_carte" as const),
      effective_monthly_price: enabled ? Number(price?.monthly_price ?? 0) : 0,
    };
  });

  const { error: modulesError } = await supabase
    .from("organization_modules")
    .upsert(rows, { onConflict: "organization_id,module_key" });
  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
