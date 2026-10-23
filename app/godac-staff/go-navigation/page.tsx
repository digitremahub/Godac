import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";
import { InvitationsGoNavigation, type LigneInvitationStaff } from "@/components/godac-staff/InvitationsGoNavigation";
import { ResumeApporteursStaff } from "@/components/godac-staff/ResumeApporteursStaff";
import { apporteurStaff, nomsApporteurs, resumerParApporteurStaff } from "@/lib/partage-go/staff";

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
  const colonnes = "id, note, expires_at, created_at, created_by_email, used_at, revoked_at, organization_id, organizations(name)";
  const lire = (cols: string) => admin.from("go_navigation_invitations").select(cols).order("created_at", { ascending: false }).limit(200);
  // Colonnes du suivi d'apporteur absentes (migration 20261103000003 non appliquée) : liste sans apporteur.
  let { data, error } = await lire(`${colonnes}, created_by_user_id, created_by_org_id, referral_link_id`);
  const suiviApporteur = !error;
  if (error?.code === "42703") ({ data, error } = await lire(colonnes));

  const brut = (data ?? []) as any[];
  const comptesRes = suiviApporteur
    ? await admin
        .from("organizations")
        .select("id, offre, subscription_status, trial_ends_at, referred_by_user_id, referred_by_org_id")
        .not("referred_by_user_id", "is", null)
    : { data: [] as any[] };
  const comptes = (comptesRes.data ?? []) as any[];
  const noms = await nomsApporteurs(
    admin,
    [...brut.map((r) => r.created_by_user_id).filter(Boolean), ...comptes.map((c) => c.referred_by_user_id)],
    [...brut.map((r) => r.created_by_org_id).filter(Boolean), ...comptes.map((c) => c.referred_by_org_id).filter(Boolean)],
  );

  const lignes: LigneInvitationStaff[] = brut.map((r) => {
    const a = r.created_by_user_id ? apporteurStaff(r.created_by_user_id, r.created_by_org_id ?? null, noms) : null;
    return {
      id: r.id,
      note: r.note,
      expiresAt: r.expires_at,
      createdAt: r.created_at,
      createdBy: r.created_by_email,
      usedAt: r.used_at,
      revokedAt: r.revoked_at,
      organizationId: r.organization_id,
      organizationName: r.organizations?.name ?? null,
      apporteur: a ? (a.organisation ? `${a.nom} (${a.organisation})` : a.nom) : null,
      viaLien: Boolean(r.referral_link_id),
    };
  });
  const resume = resumerParApporteurStaff(comptes, noms);

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
        <>
          <InvitationsGoNavigation invitations={lignes} />
          {suiviApporteur && <ResumeApporteursStaff lignes={resume} />}
        </>
      )}
    </main>
  );
}
