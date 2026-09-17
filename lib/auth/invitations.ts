import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types/domain";

/**
 * Invites a new team member via Supabase Auth's own email flow — no
 * password to set, no separate identity provider. `organization_id`
 * / `role` / `service_id` go into the invited user's `app_metadata`
 * (admin-only, never user-editable — unlike `user_metadata`, which a
 * signed-in user can change themselves via `updateUser`). RLS/route
 * logic that trusts these values (lib/auth/provisioning.ts) reads
 * app_metadata specifically for that reason.
 */
export async function inviteOrganizationMember({
  email,
  fullName,
  role,
  roleTitle,
  organizationId,
  serviceId,
}: {
  email: string;
  fullName?: string;
  role: UserRole;
  roleTitle?: string;
  organizationId: string;
  serviceId?: string;
}) {
  const admin = createAdminSupabaseClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: fullName ? { full_name: fullName } : undefined,
    redirectTo: `${appUrl}/auth/callback?next=/onboarding`,
  });
  if (inviteError) throw inviteError;

  const { error: metadataError } = await admin.auth.admin.updateUserById(invited.user.id, {
    app_metadata: { organization_id: organizationId, role, role_title: roleTitle ?? null, service_id: serviceId ?? null },
  });
  if (metadataError) throw metadataError;

  return invited;
}
