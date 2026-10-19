import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { moduleDisponible } from "@/lib/pays/pays";
import { getFullCatalog, type PlanId } from "@/lib/organization/catalog";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserPaliers } from "@/lib/organization/paliers-serveur";
import { calculerLignesModules, estEnEssai, modulesPayantsAjoutes } from "@/lib/organization/facturation-modules";

const bodySchema = z.object({
  selectedModuleKeys: z.array(z.string()),
});

/**
 * Post-signup module changes from the billing page (Module 9). Same
 * write pattern as app/api/onboarding/modules/route.ts, but reads the
 * org's current plan rather than changing it — this route only flips
 * which à-la-carte modules are on.
 *
 * Sécurité (audit C4) : prix toujours tirés de la grille, écriture par le
 * client admin. Pendant l'essai, tout module de la grille peut être
 * activé ; une fois l'abonnement Stripe souscrit, un module payant ne
 * peut plus être ajouté ici (il doit passer par Stripe), seuls les
 * retraits et les modules gratuits sont acceptés.
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

  const admin = createAdminSupabaseClient();
  const { data: organization } = await admin
    .from("organizations")
    .select("plan, country, subscription_status, stripe_subscription_id")
    .eq("id", appUser.organization_id)
    .single();
  if (!organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }
  const planId = organization.plan as PlanId;

  const { modules, prices } = await getFullCatalog(admin);
  const rows = calculerLignesModules({
    organizationId: appUser.organization_id,
    planId,
    modules,
    prices,
    selection: new Set(parsed.data.selectedModuleKeys),
    disponible: (key) => moduleDisponible(organization.country, key),
  });

  if (!estEnEssai(organization)) {
    const { data: actifs, error: actifsError } = await admin
      .from("organization_modules")
      .select("module_key")
      .eq("organization_id", appUser.organization_id)
      .eq("enabled", true);
    if (actifsError) return NextResponse.json({ error: actifsError.message }, { status: 500 });
    const refuses = modulesPayantsAjoutes(rows, new Set((actifs ?? []).map((a) => a.module_key as string)));
    if (refuses.length > 0) {
      return NextResponse.json(
        { error: `Module payant à ajouter à votre abonnement : contactez GODAC (${refuses.join(", ")}).`, modules: refuses },
        { status: 402 },
      );
    }
  }

  const { error: modulesError } = await admin.from("organization_modules").upsert(rows, { onConflict: "organization_id,module_key" });
  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }
  // App Livreur : prix selon le palier d'utilisateurs de l'entreprise.
  await synchroniserPaliers(admin, appUser.organization_id);

  return NextResponse.json({ ok: true });
}
