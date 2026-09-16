import "server-only";
import { auth, currentUser } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/domain";

export interface AppUser {
  id: string;
  organization_id: string;
  role: UserRole;
  full_name: string;
  email: string;
  active: boolean;
}

/**
 * The 5 GODAC roles are domain-specific, so they live in our own
 * `users` table (kept in sync with Clerk via the
 * app/api/webhooks/clerk route) rather than in Clerk's own
 * org-role system, which only knows "admin" / "basic_member".
 */
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, role, full_name, email, active")
    .eq("clerk_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getCurrentAppUser: supabase error", error);
    return null;
  }

  return data as AppUser | null;
}

export async function requireAppUser(): Promise<AppUser> {
  const user = await getCurrentAppUser();
  if (!user) {
    throw new Error(
      "No GODAC user profile found for the signed-in Clerk account. " +
        "Has the Clerk webhook synced this org/user into Supabase yet?",
    );
  }
  return user;
}

export function hasRole(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}

export { ROLE_LABELS } from "@/lib/roles/labels";

export async function getCurrentClerkProfile() {
  return currentUser();
}
