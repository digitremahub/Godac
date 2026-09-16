import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import type { UserRole } from "@/lib/types/domain";

/**
 * Keeps Clerk's membership publicMetadata in sync when a role is
 * changed from the admin UI, so a future organizationMembership.updated
 * webhook (e.g. the user leaving and rejoining) doesn't silently
 * revert them to their original invited role.
 */
export async function updateOrganizationMemberRole({
  clerkOrgId,
  clerkUserId,
  role,
}: {
  clerkOrgId: string;
  clerkUserId: string;
  role: UserRole;
}) {
  const client = await clerkClient();
  return client.organizations.updateOrganizationMembershipMetadata({
    organizationId: clerkOrgId,
    userId: clerkUserId,
    publicMetadata: { role },
  });
}

/**
 * Sends the actual account invitation through Clerk (secure signup
 * link, no password handling on our side). GODAC's own Resend
 * templates (lib/email) are used for in-product notifications —
 * alerts, OCR review reminders — not for the account invite itself.
 *
 * `role` and `serviceId` are carried in the invitation's
 * publicMetadata; app/api/webhooks/clerk/route.ts reads them back off
 * the resulting organizationMembership to populate users.role and
 * user_services once the invitee accepts.
 */
export async function inviteOrganizationMember({
  clerkOrgId,
  email,
  role,
  serviceId,
  inviterUserId,
}: {
  clerkOrgId: string;
  email: string;
  role: UserRole;
  serviceId?: string;
  inviterUserId: string;
}) {
  const client = await clerkClient();
  return client.organizations.createOrganizationInvitation({
    organizationId: clerkOrgId,
    emailAddress: email,
    inviterUserId,
    role: "org:member",
    publicMetadata: {
      role,
      service_id: serviceId ?? null,
    },
  });
}
