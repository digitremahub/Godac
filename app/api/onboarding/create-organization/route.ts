import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PAYS, type CodePays } from "@/lib/pays/pays";
import { getFullCatalog, priceFor } from "@/lib/organization/catalog";
import { appliquerInfosEntreprise, infosEntrepriseSchema, type BilanApplication } from "@/lib/organization/entreprise-serveur";
import { analyserIdentifiant } from "@/lib/organization/siret";

const bodySchema = z.object({
  name: z.string().min(1),
  country: z.enum(PAYS.map((p) => p.code) as [CodePays, ...CodePays[]]).default("FR"),
  /** Fiche SIRENE trouvée par /api/entreprise/recherche (bouton « Rechercher »). */
  entreprise: infosEntrepriseSchema.optional(),
  /** SIRET saisi sans recherche (API injoignable, ou saisie manuelle). */
  siret: z.string().trim().max(30).optional(),
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
    // Pointage assisté (badge géolocalisé au dépôt) activé d'office ; désactivable dans Organisation.
    .insert({ name: parsed.data.name, country: parsed.data.country, auto_clock_enabled: true })
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

  // Pôles standard (direction, secrétariat, comptabilité…) : un service
  // par pôle bureau, comme pour les entreprises existantes (migration
  // 20260101000126). Idempotent ; un échec ne bloque pas l'inscription,
  // la même fonction peut être rejouée.
  const { error: polesError } = await admin.rpc("seed_standard_poles", { p_organization_id: organization.id });
  if (polesError) console.error("seed_standard_poles", polesError.message);

  // Fiche SIRENE → identité légale, dépôt, convention et réglages de
  // paie. Organisation neuve : tous les champs sont vides, rien n'est
  // écrasé. Un échec laisse la saisie manuelle dans Organisation.
  let bilan: BilanApplication | null = null;
  if (parsed.data.entreprise) {
    try {
      bilan = await appliquerInfosEntreprise(admin, organization.id, parsed.data.entreprise, []);
    } catch (e) {
      console.error("appliquerInfosEntreprise", e);
    }
  } else if (parsed.data.siret) {
    const id = analyserIdentifiant(parsed.data.siret);
    if (id.type !== "invalide") {
      await admin
        .from("organizations")
        .update(id.type === "siret" ? { siret: id.valeur, siren: id.siren } : { siren: id.siren })
        .eq("id", organization.id);
    }
  }

  return NextResponse.json({ organizationId: organization.id, bilan });
}
