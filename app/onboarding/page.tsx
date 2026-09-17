import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentAppUser } from "@/lib/auth/session";
import { tryAutoProvisionInvitedUser } from "@/lib/auth/provisioning";
import { getFullCatalog } from "@/lib/organization/catalog";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  // Already has a profile (either from a prior visit here, or just
  // auto-provisioned as an invited member) — nothing left to do.
  const existing = (await getCurrentAppUser()) ?? (await tryAutoProvisionInvitedUser());
  if (existing) redirect("/dashboard");

  const params = await searchParams;
  const { plans, modules, prices } = await getFullCatalog(supabase);
  // Essentiel is request-only (see supabase/migrations/20260101000023) —
  // self-serve onboarding only ever offers the public plans.
  const catalog = { plans: plans.filter((p) => p.is_public), modules, prices };

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <OnboardingWizard stripeStatus={params.stripe} catalog={catalog} />
    </main>
  );
}
