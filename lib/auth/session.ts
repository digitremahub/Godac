import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/domain";

export interface AppUser {
  id: string;
  organization_id: string;
  role: UserRole;
  role_title: string | null;
  full_name: string;
  email: string;
  active: boolean;
}

/**
 * The 5 GODAC roles are domain-specific and live in our own `users`
 * table, keyed by the Supabase Auth user id (see
 * supabase/migrations/20260101000002_core_tables.sql).
 */
export async function getCurrentAppUser(): Promise<AppUser | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, role, role_title, full_name, email, active")
    .eq("id", user.id)
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
      "No GODAC user profile found for the signed-in account. Has onboarding / invite acceptance completed yet?",
    );
  }
  return user;
}

export function hasRole(role: UserRole, allowed: UserRole[]): boolean {
  return allowed.includes(role);
}

export { ROLE_LABELS } from "@/lib/roles/labels";
