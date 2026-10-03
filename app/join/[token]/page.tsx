import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/ui";
import { JoinDriverForm } from "@/components/auth/JoinDriverForm";

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

  const { data: organization } = await admin
    .from("organizations")
    .select("id, name, services(id, name)")
    .eq("driver_signup_token", token)
    .maybeSingle();

  if (!organization) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <EmptyState title="Lien invalide" description="Ce lien d'inscription n'est pas ou plus valide. Contactez votre entreprise." />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </div>
      {/*
        The org's own name/logo is deliberately NOT shown here — the
        company-name field in JoinDriverForm is a genuine check (the
        driver types what they believe their employer is called,
        compared server-side against what the token actually
        resolves to) rather than the driver just copying back a name
        already displayed on screen, which would catch nothing.
      */}
      <JoinDriverForm token={token} services={(organization.services as { id: string; name: string }[]) ?? []} />
    </main>
  );
}
