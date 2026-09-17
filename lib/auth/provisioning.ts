import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { AppUser } from "@/lib/auth/session";
import type { UserRole } from "@/lib/types/domain";

/**
 * Called for a signed-in user who has no `public.users` row yet. If
 * they were invited (lib/auth/invitations.ts stamped
 * organization_id/role/service_id into their app_metadata), this
 * finishes their profile silently and they never see an onboarding
 * screen. Returns null for an organic sign-up, who goes through
 * /onboarding to create their own organisation instead.
 *
 * Uses the service-role client deliberately: app_metadata is only
 * ever set by our own admin invite call (lib/auth/invitations.ts),
 * never by the user themselves, so trusting it here to place someone
 * into an organization is safe.
 */
export async function tryAutoProvisionInvitedUser(): Promise<AppUser | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const organizationId = user.app_metadata?.organization_id as string | undefined;
  if (!organizationId) return null;

  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("users")
    .upsert(
      {
        id: user.id,
        organization_id: organizationId,
        role: (user.app_metadata?.role as UserRole) ?? "chauffeur",
        role_title: (user.app_metadata?.role_title as string) ?? null,
        full_name: (user.user_metadata?.full_name as string) ?? user.email ?? "Utilisateur",
        email: user.email!,
      },
      { onConflict: "id" },
    )
    .select("id, organization_id, role, role_title, full_name, email, active")
    .single();

  if (error) {
    console.error("tryAutoProvisionInvitedUser: upsert failed", error);
    return null;
  }

  const serviceId = user.app_metadata?.service_id as string | undefined;
  if (serviceId) {
    const { error: serviceLinkError } = await admin
      .from("user_services")
      .upsert({ user_id: user.id, service_id: serviceId }, { onConflict: "user_id,service_id" });
    if (serviceLinkError) console.error("tryAutoProvisionInvitedUser: service link failed", serviceLinkError);
  }

  return data as AppUser;
}
