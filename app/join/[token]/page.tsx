import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { organisationParJeton } from "@/lib/organization/lien-inscription";
import { EmptyState } from "@/components/ui";
import { JoinDriverForm } from "@/components/auth/JoinDriverForm";
import { AuthLayout } from "@/components/auth/AuthLayout";

/**
 * Self-service driver onboarding — one reusable, regenerable link/QR
 * per organization (printed once at the depot), as opposed to the
 * Lot 7 badge which is per-driver and created by an admin first. No
 * session exists yet, so the org lookup goes through the admin client
 * like app/driver-pin/[id] — only the minimum needed to render the
 * form (name, logo, services to pick from) is read.
 */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminSupabaseClient();

  const organizationId = await organisationParJeton(admin, token);
  const { data: organization } = organizationId
    ? await admin.from("organizations").select("id, name, services(id, name)").eq("id", organizationId).maybeSingle()
    : { data: null };

  if (!organization) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <EmptyState title="Lien invalide" description="Ce lien d'inscription n'est pas ou plus valide. Contactez votre entreprise." />
      </main>
    );
  }

  return (
    <AuthLayout linkLogo={false}>
      {/*
        The org's own name/logo is deliberately NOT shown here — the
        company-name field in JoinDriverForm is a genuine check (the
        driver types what they believe their employer is called,
        compared server-side against what the token actually
        resolves to) rather than the driver just copying back a name
        already displayed on screen, which would catch nothing.
      */}
      <JoinDriverForm token={token} services={(organization.services as { id: string; name: string }[]) ?? []} />
    </AuthLayout>
  );
}
