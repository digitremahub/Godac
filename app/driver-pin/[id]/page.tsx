import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { EmptyState } from "@/components/ui";
import { DriverPinFlow } from "@/components/auth/DriverPinFlow";

/**
 * Landing page for a chauffeur's QR badge scanned while signed out
 * (see app/scan/[type]/[id]/page.tsx, which routes here only for a
 * `driver` badge whose account uses `auth_method = 'pin'`). Public —
 * there's no session yet — so the lookup goes through the admin
 * client rather than the usual RLS-scoped one; only the minimum
 * needed to render the right form is read.
 */
export default async function DriverPinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = createAdminSupabaseClient();
  const [{ data: user }, { count: passkeyCount }] = await Promise.all([
    admin
      .from("users")
      .select("full_name, email, auth_method, pin_set_at, active, pending_approval")
      .eq("id", id)
      .maybeSingle(),
    admin.from("webauthn_credentials").select("id", { count: "exact", head: true }).eq("user_id", id),
  ]);

  if (!user || user.auth_method !== "pin" || !user.active) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <EmptyState
          title="Badge invalide"
          description="Ce badge ne permet pas de se connecter. Contactez un responsable GODAC."
        />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex items-center gap-2.5">
        <div aria-hidden="true" className="h-8 w-8 rounded-lg bg-teal shadow-[0_2px_12px_-2px_rgba(27,228,193,0.6)]" />
        <span className="font-display text-xl font-extrabold">GODAC</span>
      </div>
      <DriverPinFlow
        id={id}
        fullName={user.full_name}
        email={user.email}
        needsSetup={!user.pin_set_at}
        pendingApproval={user.pending_approval}
        hasPasskey={(passkeyCount ?? 0) > 0}
      />
    </main>
  );
}
