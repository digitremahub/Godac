import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DepotFacturation, OrgFacturable } from "@/lib/usage/facturation";

/** Accès base de la facturation du dépassement (client service). */
export function depotFacturationSupabase(admin: SupabaseClient): DepotFacturation {
  return {
    async organisations() {
      const { data, error } = await admin
        .from("organizations")
        .select("id, plan, plan_id, stripe_customer_id, stripe_subscription_id")
        .not("stripe_customer_id", "is", null);
      if (error) throw new Error(`Organisations illisibles : ${error.message}`);
      return (data ?? []) as OrgFacturable[];
    },
    async quotas() {
      const { data, error } = await admin.from("usage_quotas").select("plan_id, feature, included_per_month");
      if (error) throw new Error(`Quotas illisibles : ${error.message}`);
      return data ?? [];
    },
    async prix() {
      const { data, error } = await admin.from("usage_prices").select("feature, unit_price_eur, label");
      if (error) throw new Error(`Prix illisibles : ${error.message}`);
      return (data ?? []).map((p) => ({ ...p, unit_price_eur: Number(p.unit_price_eur) }));
    },
    async totaux(organizationId, debut, fin) {
      const { data, error } = await admin.rpc("usage_totals", { p_org: organizationId, p_from: debut, p_to: fin });
      if (error) throw new Error(`Consommation illisible : ${error.message}`);
      return ((data ?? []) as { feature: string; units: number }[]).map((t) => ({ feature: t.feature, units: Number(t.units) }));
    },
    async reserver(ligne) {
      const { error } = await admin.from("usage_billing_runs").insert(ligne);
      if (!error) return true;
      if (error.code === "23505") return false; // déjà facturée (contrainte unique)
      throw new Error(`Réservation impossible : ${error.message}`);
    },
    async confirmer(organizationId, periode, feature, stripeInvoiceItemId) {
      await admin
        .from("usage_billing_runs")
        .update({ stripe_invoice_item_id: stripeInvoiceItemId })
        .eq("organization_id", organizationId)
        .eq("period", periode)
        .eq("feature", feature);
    },
    async liberer(organizationId, periode, feature) {
      await admin
        .from("usage_billing_runs")
        .delete()
        .eq("organization_id", organizationId)
        .eq("period", periode)
        .eq("feature", feature)
        .is("stripe_invoice_item_id", null);
    },
  };
}
