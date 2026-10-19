import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { moduleDisponible } from "@/lib/pays/pays";
import { getFullCatalog, type PlanId } from "@/lib/organization/catalog";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserPaliers } from "@/lib/organization/paliers-serveur";
import { calculerLignesModules, estEnEssai } from "@/lib/organization/facturation-modules";

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
 *
 * Sécurité (audit C4) : réservé à la direction et à la période d'essai
 * (aucun abonnement Stripe). Une fois abonné, le plan ne change plus que
 * par le webhook Stripe. Écriture par le client admin : la direction n'a
 * plus le droit d'écrire elle-même ces colonnes (migration 20261019000002).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut choisir la formule." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const planId = parsed.data.planId as PlanId;
  if (planId === "essentiel") {
    return NextResponse.json({ error: "Le plan Essentiel est accessible sur demande uniquement, contactez GODAC." }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  const { data: organization, error: orgError } = await admin
    .from("organizations")
    .select("country, subscription_status, stripe_subscription_id")
    .eq("id", appUser.organization_id)
    .single();
  if (orgError || !organization) {
    return NextResponse.json({ error: "Organisation introuvable" }, { status: 409 });
  }
  if (!estEnEssai(organization)) {
    return NextResponse.json(
      { error: "Votre abonnement est déjà souscrit : changez de formule depuis la page Abonnement." },
      { status: 409 },
    );
  }

  const { error: planError } = await admin.from("organizations").update({ plan: planId }).eq("id", appUser.organization_id);
  if (planError) {
    return NextResponse.json({ error: planError.message }, { status: 500 });
  }

  const { modules, prices } = await getFullCatalog(admin);
  const rows = calculerLignesModules({
    organizationId: appUser.organization_id,
    planId,
    modules,
    prices,
    selection: new Set(parsed.data.selectedModuleKeys),
    disponible: (key) => moduleDisponible(organization.country, key),
  });

  const { error: modulesError } = await admin.from("organization_modules").upsert(rows, { onConflict: "organization_id,module_key" });
  if (modulesError) {
    return NextResponse.json({ error: modulesError.message }, { status: 500 });
  }
  // App Livreur : prix selon le palier d'utilisateurs de l'entreprise.
  await synchroniserPaliers(admin, appUser.organization_id);

  return NextResponse.json({ ok: true });
}
