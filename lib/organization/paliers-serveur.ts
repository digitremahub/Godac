import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe/client";
import { MODULES_PAR_PALIER, prixPalier, type PalierUtilisateurs } from "@/lib/organization/paliers";

/** Utilisateurs de l'app Livreur : chauffeurs actifs (validés, non supprimés). */
export async function compterUtilisateursLivreur(supabase: SupabaseClient, organizationId: string): Promise<number> {
  const { count } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("role", ["chauffeur", "manager_chauffeur"])
    .eq("active", true)
    .eq("pending_approval", false)
    .is("deleted_at", null);
  return count ?? 0;
}

export async function getPaliers(supabase: SupabaseClient): Promise<PalierUtilisateurs[]> {
  const { data } = await supabase.from("module_user_tiers").select("*");
  return (data ?? []) as PalierUtilisateurs[];
}

/**
 * Recalcule le prix des modules facturés au palier pour une entreprise
 * (ou toutes) et répercute un changement sur l'abonnement Stripe à la
 * prochaine échéance (sans prorata). Appelé chaque nuit et à la commande.
 */
export async function synchroniserPaliers(admin: SupabaseClient, organizationId?: string) {
  const paliers = await getPaliers(admin);
  let requete = admin
    .from("organization_modules")
    .select("organization_id, module_key, effective_monthly_price, billed_users, organizations(stripe_subscription_id)")
    .in("module_key", [...MODULES_PAR_PALIER])
    .eq("enabled", true)
    .eq("pricing_mode", "a_la_carte");
  if (organizationId) requete = requete.eq("organization_id", organizationId);
  const { data: lignes } = await requete;

  const changes: { organizationId: string; moduleKey: string; utilisateurs: number; prix: number }[] = [];
  for (const l of lignes ?? []) {
    const utilisateurs = await compterUtilisateursLivreur(admin, l.organization_id);
    const prix = prixPalier(paliers, l.module_key, utilisateurs);
    if (prix === null) continue;
    if (prix === Number(l.effective_monthly_price) && l.billed_users === utilisateurs) continue;
    await admin
      .from("organization_modules")
      .update({ effective_monthly_price: prix, billed_users: utilisateurs })
      .eq("organization_id", l.organization_id)
      .eq("module_key", l.module_key);
    const org = (Array.isArray(l.organizations) ? l.organizations[0] : l.organizations) as { stripe_subscription_id: string | null } | null;
    if (prix !== Number(l.effective_monthly_price) && org?.stripe_subscription_id) {
      await majAbonnement(org.stripe_subscription_id, l.module_key, prix).catch((e) => console.error("palier stripe", e));
    }
    changes.push({ organizationId: l.organization_id, moduleKey: l.module_key, utilisateurs, prix });
  }
  return changes;
}

async function majAbonnement(subscriptionId: string, moduleKey: string, prix: number) {
  const stripe = getStripeClient();
  const abonnement = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price.product"] });
  const ligne = abonnement.items.data.find((item) => {
    const produit = item.price.product;
    return typeof produit === "object" && "metadata" in produit && produit.metadata?.godac_module === moduleKey;
  });
  if (!ligne) return;
  const produit = typeof ligne.price.product === "string" ? ligne.price.product : ligne.price.product.id;
  await stripe.subscriptionItems.update(ligne.id, {
    price_data: { currency: "eur", product: produit, unit_amount: Math.round(prix * 100), recurring: { interval: "month" } },
    proration_behavior: "none",
  });
}
