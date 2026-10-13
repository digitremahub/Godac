import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleDisponible } from "@/lib/pays/pays";
import { paysOrganisation } from "@/lib/pays/serveur";
import { getFullCatalog, priceFor, type PlanId } from "@/lib/organization/catalog";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserPaliers } from "@/lib/organization/paliers-serveur";

const bodySchema = z.object({
  planId: z.enum(["essentiel", "starter", "pro", "business"]),
  selectedModuleKeys: z.array(z.string()),
});

/**
 * Onboarding module-selection step: persists the chosen plan and
 * which à-la-carte modules the org picked on top of it, into the
 * generic organization_modules switchboard (see migration
 * 20260101000015_module_catalog.sql). V3 modules aren't sellable yet
 * and are silently ignored even if sent.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const planId = parsed.data.planId as PlanId;
  if (planId === "essentiel") {
    return NextResponse.json({ error: "Le plan Essentiel est accessible sur demande uniquement, contactez GODAC." }, { status: 403 });
  }
  const selected = new Set(parsed.data.selectedModuleKeys);

  const supabase = await createServerSupabaseClient();

  const { error: planError } = await supabase
    .from("organizations")
    .update({ plan: planId })
    .eq("id", appUser.organization_id);
  if (planError) {
    return NextResponse.json({ error: planError.message }, { status: 500 });
  }

  const pays = await paysOrganisation(supabase, appUser.organization_id);
  const { modules, prices } = await getFullCatalog(supabase);
  const sellable = modules.filter((m) => m.wave !== "v3");

  const rows = sellable.map((m) => {
    const price = priceFor(prices, m.key, planId);
    const included = price?.included ?? false;
    // Jamais activé (ni facturé) un module sans objet dans le pays de l'entreprise.
    const enabled = (included || selected.has(m.key)) && moduleDisponible(pays.code, m.key);
    return {
      organization_id: appUser.organization_id,
      module_key: m.key,
      enabled,
      pricing_mode: included ? ("included" as const) : ("a_la_carte" as const),
      effective_monthly_price: enabled ? Number(price?.monthly_price ?? 0) : 0,
      effective_setup_price: enabled && !included ? Number(price?.setup_price ?? 0) : 0,
    };
  });

  const { error: modulesError } = await supabase
    .from("organization_modules")
    .upsert(rows, { onConflict: "organization_id,module_key" });
  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }
  // App Livreur : prix selon le palier d'utilisateurs de l'entreprise.
  await synchroniserPaliers(createAdminSupabaseClient(), appUser.organization_id);

  return NextResponse.json({ ok: true });
}
