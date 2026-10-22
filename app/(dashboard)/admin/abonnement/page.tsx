import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { BillingPanel } from "@/components/admin/BillingPanel";
import { UsagePanel, type HistoriqueMois } from "@/components/admin/UsagePanel";
import { ModulesPanel, type LigneModuleAffichee } from "@/components/admin/ModulesPanel";
import { JaugeQuota } from "@/components/acces/JaugeQuota";
import { MODULES_SOCLE, estModuleVendable } from "@/lib/acces/catalogue";
import { limiteVehicules } from "@/lib/acces/limites-serveur";
import { getFullCatalog, priceFor, type PlanId } from "@/lib/organization/catalog";
import { estEnEssai } from "@/lib/organization/facturation-modules";
import { moduleDisponible } from "@/lib/pays/pays";
import { bornesMoisParis, derniersMois, lignesConsommation, resoudreFormule, unitesEnDepassement, montantCentimes } from "@/lib/usage/quotas";

type Vue = "formule" | "modules";

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ vue?: string }> }) {
  const g = await garderPage("admin.abonnement");
  if (!g.ok) return g.ecran;
  const { appUser, supabase } = g;
  const { vue: vueParam } = await searchParams;
  const vue: Vue = vueParam === "modules" ? "modules" : "formule";
  const { data: organization } = await supabase
    .from("organizations")
    .select("plan, subscription_status, stripe_customer_id, stripe_subscription_id, country")
    .eq("id", appUser.organization_id)
    .single();

  const onglets = (
    <nav aria-label="Abonnement" className="mb-5 flex gap-1 overflow-x-auto border-b border-navy/10">
      {(
        [
          ["formule", "/admin/abonnement", "Formule & consommation"],
          ["modules", "/admin/abonnement?vue=modules", "Modules"],
        ] as const
      ).map(([cle, href, label]) => (
        <Link
          key={cle}
          href={href}
          aria-current={vue === cle ? "page" : undefined}
          className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
            vue === cle ? "border-teal text-navy" : "border-transparent text-navy/55 hover:text-navy"
          }`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );

  if (vue === "modules") {
    const formule = (organization?.plan ?? "starter") as PlanId;
    const [{ modules, prices, plans }, { data: actifs }] = await Promise.all([
      getFullCatalog(supabase),
      supabase.from("organization_modules").select("module_key, enabled").eq("organization_id", appUser.organization_id),
    ]);
    const actif = new Set((actifs ?? []).filter((r) => r.enabled).map((r) => r.module_key as string));
    const lignes: LigneModuleAffichee[] = modules
      // Q7 : jamais les modules sans fonctionnalité ; ni le socle, toujours actif.
      .filter((m) => estModuleVendable(m) && !MODULES_SOCLE.includes(m.key) && moduleDisponible(organization?.country, m.key))
      .map((m) => {
        const prix = priceFor(prices, m.key, formule);
        return {
          key: m.key,
          name: m.name,
          description: m.description ?? "",
          inclus: prix?.included ?? false,
          actif: actif.has(m.key),
          prixMensuel: Number(prix?.monthly_price ?? 0),
          prixMiseEnService: Number(prix?.setup_price ?? 0),
        };
      });
    const nomFormule = plans.find((p) => p.id === formule)?.name ?? formule;
    return (
      <div>
        <PageHeader title="Abonnement & modules" description="Activez les modules de votre espace GODAC." />
        {onglets}
        <ModulesPanel
          modules={lignes}
          formule={nomFormule}
          enEssai={estEnEssai({ subscription_status: organization?.subscription_status ?? null, stripe_subscription_id: organization?.stripe_subscription_id ?? null })}
        />
      </div>
    );
  }

  // Lu à part : une colonne absente (migration 130 non appliquée) ne doit pas masquer l'abonnement.
  const [{ data: reglages }, consommation, vehicules] = await Promise.all([
    supabase.from("organizations").select("usage_overage_enabled").eq("id", appUser.organization_id).maybeSingle(),
    chargerConsommation(supabase, appUser.organization_id, resoudreFormule(organization?.plan)),
    limiteVehicules(appUser.organization_id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <PageHeader title="Abonnement & modules" description="Formule, factures et consommation." />
        {onglets}
        <BillingPanel
          plan={organization?.plan ?? "starter"}
          status={organization?.subscription_status ?? "trialing"}
          hasStripeCustomer={Boolean(organization?.stripe_customer_id)}
        />
      </div>
      {vehicules.inclus !== null && (
        <div className="max-w-md">
          <JaugeQuota libelle={`Véhicules (formule ${vehicules.nomFormule ?? ""})`} utilise={vehicules.utilise} inclus={vehicules.inclus} direction />
        </div>
      )}
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

type Supabase = import("@supabase/supabase-js").SupabaseClient;

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
