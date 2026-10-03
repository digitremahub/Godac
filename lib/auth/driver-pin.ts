import "server-only";
import { randomUUID } from "crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types/domain";

/**
 * Creates a chauffeur account with no real email — Lot 7's validated
 * plan. Supabase Auth still needs *an* email per account, so this
 * fabricates an internal, never-delivered one
 * (`chauffeur-<uuid>@<org>.godac.local`); it's never shown to the
 * driver and grants nothing by itself (the PIN they set at first scan
 * is the real credential, see app/driver-pin/[id]). The temporary
 * password set here is a long random string nobody ever sees — it's
 * immediately replaced the moment the driver sets their PIN
 * (app/api/auth/driver-pin/[id]/set/route.ts).
 */
export async function createPinDriver({
  fullName,
  role,
  roleTitle,
  phone,
  organizationId,
  serviceId,
  pendingApproval,
}: {
  fullName: string;
  role: UserRole;
  roleTitle?: string;
  phone?: string;
  organizationId: string;
  serviceId?: string;
  /** Self-service signup (app/join/[token]) — created active=true but unable to sign in (lib/auth/session.ts) until a manager-like/direction approves. */
  pendingApproval?: boolean;
}): Promise<{ id: string }> {
  const admin = createAdminSupabaseClient();
  const internalEmail = `chauffeur-${randomUUID()}@${organizationId}.godac.local`;
  const temporaryPassword = `${randomUUID()}${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: internalEmail,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError) throw createError;

  const { error: profileError } = await admin.from("users").insert({
    id: created.user.id,
    organization_id: organizationId,
    role,
    role_title: roleTitle ?? null,
    full_name: fullName,
    email: internalEmail,
    phone: phone ?? null,
    auth_method: "pin",
    pending_approval: pendingApproval ?? false,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id);
    throw profileError;
  }

  if (serviceId) {
    const { error: serviceLinkError } = await admin
      .from("user_services")
      .upsert({ user_id: created.user.id, service_id: serviceId }, { onConflict: "user_id,service_id" });
    if (serviceLinkError) console.error("createPinDriver: service link failed", serviceLinkError);
  }

  return { id: created.user.id };
}
