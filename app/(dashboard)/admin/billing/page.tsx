import { requireAppUser } from "@/lib/clerk/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { BillingPanel } from "@/components/admin/BillingPanel";

export default async function BillingPage() {
  const appUser = await requireAppUser();
  const supabase = createServerSupabaseClient();
  const { data: organization } = await supabase
    .from("organizations")
    .select("plan, subscription_status, stripe_customer_id")
    .eq("id", appUser.organization_id)
    .single();

  return (
    <div>
      <PageHeader title="Abonnement" description="Plan tarifaire et facturation GODAC (Stripe)." />
      <BillingPanel
        plan={organization?.plan ?? "starter"}
        status={organization?.subscription_status ?? "trialing"}
        hasStripeCustomer={Boolean(organization?.stripe_customer_id)}
      />
    </div>
  );
}
