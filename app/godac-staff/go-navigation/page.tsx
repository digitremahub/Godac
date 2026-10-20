import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";
import { InvitationsGoNavigation, type LigneInvitationStaff } from "@/components/godac-staff/InvitationsGoNavigation";

/**
 * Backoffice GODAC › Invitations GO Navigation : génération des liens
 * uniques d'essai et suivi (envoyée / utilisée / expirée / révoquée).
 * Même contrôle d'accès que app/godac-staff/page.tsx (GODAC_STAFF_EMAILS).
 */
export default async function InvitationsGoNavigationPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) redirect("/dashboard");

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("go_navigation_invitations")
    .select("id, note, expires_at, created_at, created_by_email, used_at, revoked_at, organization_id, organizations(name)")
    .order("created_at", { ascending: false })
    .limit(200);

  const lignes: LigneInvitationStaff[] = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    note: r.note,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    createdBy: r.created_by_email,
    usedAt: r.used_at,
    revokedAt: r.revoked_at,
    organizationId: r.organization_id,
    organizationName: r.organizations?.name ?? null,
  }));

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title="Invitations GO Navigation"
        description="Liens uniques d'inscription à l'essai GO Navigation (30 jours, Tournée colis seule, 3 000 lectures d'étiquettes et 300 optimisations par mois)."
      />
      <p className="mb-4 text-sm">
        <Link href="/godac-staff" className="text-teal-ink hover:underline">
          ← Backoffice opérateur
        </Link>
      </p>
      {error ? (
        <Card>
          <p className="text-sm text-navy/70">Invitations indisponibles : appliquez la migration 20261023000003_inscription_go_navigation.sql.</p>
        </Card>
      ) : (
        <InvitationsGoNavigation invitations={lignes} />
      )}
    </main>
  );
}
