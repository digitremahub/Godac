import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CreateOrganization } from "@clerk/nextjs";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ stripe?: string }>;
}) {
  const { userId, orgId } = await auth();
  if (!userId) redirect("/sign-in");

  const params = await searchParams;

  if (!orgId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
        <div className="text-center">
          <h1 className="text-2xl">Créez votre organisation GODAC</h1>
          <p className="mt-1 text-white/50">
            Une organisation = une entreprise de transport cliente.
          </p>
        </div>
        <CreateOrganization
          afterCreateOrganizationUrl="/onboarding"
          appearance={{ variables: { colorPrimary: "#1BE4C1" } }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl p-6">
      <OnboardingWizard stripeStatus={params.stripe} />
    </main>
  );
}
