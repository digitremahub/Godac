import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe/client";
import { MODULES_PAR_PALIER, prixPalier, type PalierUtilisateurs } from "@/lib/organization/paliers";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";

/**
 * Utilisateurs de l'app Livreur : chauffeurs actifs et validés.
 * Lève une erreur si le comptage échoue : un 0 par défaut facturerait le
 * palier minimal (audit C3, `users.deleted_at` n'existe pas en base).
 */
export async function compterUtilisateursLivreur(supabase: SupabaseClient, organizationId: string): Promise<number> {
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .or(FILTRE_CONDUCTEURS)
    .eq("active", true)
    .eq("pending_approval", false);
  if (error) throw new Error(`Comptage des utilisateurs Livreur impossible : ${error.message}`);
  if (count === null) throw new Error("Comptage des utilisateurs Livreur impossible : résultat vide");
  return count;
}

export async function getPaliers(supabase: SupabaseClient): Promise<PalierUtilisateurs[]> {
  const { data, error } = await supabase.from("module_user_tiers").select("*");
  if (error) throw new Error(`Grille des paliers illisible : ${error.message}`);
  return (data ?? []) as PalierUtilisateurs[];
}

export interface ChangementPalier {
  organizationId: string;
  moduleKey: string;
  utilisateurs: number;
  prix: number;
}

/**
 * Recalcule le prix des modules facturés au palier pour une entreprise
 * (ou toutes) et répercute un changement sur l'abonnement Stripe à la
 * prochaine échéance (sans prorata). Appelé chaque nuit et à la commande.
 *
 * En cas d'erreur de lecture (grille, modules, comptage) ou d'écriture,
 * rien n'est écrit ni poussé vers Stripe pour la ligne concernée ; les
 * erreurs de lecture globales sont levées.
 */
export async function synchroniserPaliers(admin: SupabaseClient, organizationId?: string): Promise<ChangementPalier[]> {
  const paliers = await getPaliers(admin);
  let requete = admin
    .from("organization_modules")
    .select("organization_id, module_key, effective_monthly_price, billed_users, organizations(stripe_subscription_id)")
    .in("module_key", [...MODULES_PAR_PALIER])
    .eq("enabled", true)
    .eq("pricing_mode", "a_la_carte");
  if (organizationId) requete = requete.eq("organization_id", organizationId);
  const { data: lignes, error: lignesError } = await requete;
  if (lignesError) throw new Error(`Modules au palier illisibles : ${lignesError.message}`);

  const comptes = new Map<string, number | null>();
  const changes: ChangementPalier[] = [];
  for (const l of lignes ?? []) {
    if (!comptes.has(l.organization_id)) {
      try {
        comptes.set(l.organization_id, await compterUtilisateursLivreur(admin, l.organization_id));
      } catch (e) {
        console.error("palier : comptage", l.organization_id, e);
        comptes.set(l.organization_id, null);
      }
    }
    const utilisateurs = comptes.get(l.organization_id);
    if (utilisateurs === null || utilisateurs === undefined) continue;
    const prix = prixPalier(paliers, l.module_key, utilisateurs);
    if (prix === null) continue;
    if (prix === Number(l.effective_monthly_price) && l.billed_users === utilisateurs) continue;
    const { error: majError } = await admin
      .from("organization_modules")
      .update({ effective_monthly_price: prix, billed_users: utilisateurs })
      .eq("organization_id", l.organization_id)
      .eq("module_key", l.module_key);
    if (majError) {
      console.error("palier : mise à jour", l.organization_id, l.module_key, majError.message);
      continue;
    }
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
