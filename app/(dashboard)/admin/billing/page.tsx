import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { BillingPanel } from "@/components/admin/BillingPanel";
import { UsagePanel, type HistoriqueMois } from "@/components/admin/UsagePanel";
import { bornesMoisParis, derniersMois, lignesConsommation, resoudreFormule, unitesEnDepassement, montantCentimes } from "@/lib/usage/quotas";

export default async function BillingPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("plan, subscription_status, stripe_customer_id")
    .eq("id", appUser.organization_id)
    .single();

  const isDirection = appUser.role === "direction";
  // Lu à part : une colonne absente (migration 130 non appliquée) ne doit pas masquer l'abonnement.
  const { data: reglages } = isDirection
    ? await supabase.from("organizations").select("usage_overage_enabled").eq("id", appUser.organization_id).maybeSingle()
    : { data: null };
  const consommation = isDirection ? await chargerConsommation(supabase, appUser.organization_id, resoudreFormule(organization?.plan)) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="Abonnement" description="Plan tarifaire et facturation GODAC (Stripe)." />
        <BillingPanel
          plan={organization?.plan ?? "starter"}
          status={organization?.subscription_status ?? "trialing"}
          hasStripeCustomer={Boolean(organization?.stripe_customer_id)}
        />
      </div>
      {consommation && (
        <UsagePanel
          lignes={consommation.lignes}
          historique={consommation.historique}
          periode={consommation.periode}
          overageEnabled={reglages?.usage_overage_enabled ?? true}
        />
      )}
    </div>
  );
}

type Supabase = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** Consommation du mois et des six derniers mois (fonctions RPC usage_totals / usage_monthly, RLS direction). */
async function chargerConsommation(supabase: Supabase, organizationId: string, formule: string) {
  const maintenant = new Date();
  const mois = bornesMoisParis(maintenant);
  const periodes = derniersMois(maintenant, 6);
  const [{ data: prix, error: prixError }, { data: quotas }, { data: totaux }, { data: mensuel }] = await Promise.all([
    supabase.from("usage_prices").select("feature, label, unit_label, unit_price_eur").order("sort_order"),
    supabase.from("usage_quotas").select("feature, included_per_month").eq("plan_id", formule),
    supabase.rpc("usage_totals", { p_org: organizationId, p_from: mois.debut, p_to: mois.fin }),
    supabase.rpc("usage_monthly", { p_org: organizationId, p_from: bornesMoisParis(maintenant, -5).debut }),
  ]);
  // Migration pas encore appliquée : on n'affiche rien plutôt qu'une carte vide.
  if (prixError || !prix?.length) return null;

  const prixRows = prix.map((p) => ({ ...p, unit_price_eur: Number(p.unit_price_eur) }));
  const inclus = Object.fromEntries((quotas ?? []).map((q) => [q.feature, Number(q.included_per_month)]));
  const utilise = Object.fromEntries(((totaux ?? []) as { feature: string; units: number }[]).map((t) => [t.feature, Number(t.units)]));

  const historique: HistoriqueMois[] = periodes.map((periode) => {
    const unites: Record<string, number> = {};
    for (const r of (mensuel ?? []) as { period: string; feature: string; units: number }[]) {
      if (r.period === periode) unites[r.feature] = Number(r.units);
    }
    const coutEstime =
      prixRows.reduce((s, p) => s + montantCentimes(unitesEnDepassement(unites[p.feature] ?? 0, inclus[p.feature] ?? 0), p.unit_price_eur), 0) / 100;
    return { periode, unites, coutEstime };
  });

  return { periode: mois.periode, lignes: lignesConsommation(prixRows, inclus, utilise), historique };
}
