import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/domain";
import { estConducteur } from "@/lib/roles/conducteurs";

export interface AppUser {
  id: string;
  organization_id: string;
  role: UserRole;
  role_title: string | null;
  full_name: string;
  email: string;
  phone: string | null;
  active: boolean;
  pending_approval: boolean;
  /** users.can_drive : manager qui conduit aussi (sans effet pour les autres rôles). */
  can_drive: boolean;
  /** Conduit : chauffeur, ou manager avec can_drive (lib/roles/conducteurs.ts). */
  conduit: boolean;
}

const COLONNES = "id, organization_id, role, role_title, full_name, email, phone, active, pending_approval";

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

  const lire = (colonnes: string) => supabase.from("users").select(colonnes).eq("id", user.id).maybeSingle<Record<string, unknown>>();
  let { data, error } = await lire(`${COLONNES}, can_drive`);
  // Colonne can_drive absente (migration 20261021000002 pas encore
  // appliquée) : on relit sans elle plutôt que de bloquer tout le monde.
  if (error?.code === "42703") ({ data, error } = await lire(COLONNES));

  if (error) {
    console.error("getCurrentAppUser: supabase error", error);
    return null;
  }

  // A deactivated account (Admin > Utilisateurs) keeps its row —
  // fuel_entries.driver_id is `on delete restrict`, so a driver with
  // any history can never be hard-deleted — but must actually lose
  // access, not just disappear from active-only dropdowns.
  if (data && !data.active) {
    await supabase.auth.signOut();
    return null;
  }

  // Self-registered via app/join/[token] — can set their PIN (that
  // route only checks auth_method/active) but not actually use the
  // app until a manager-like/direction approves from /equipe/inscriptions.
  if (data && data.pending_approval) {
    await supabase.auth.signOut();
    return null;
  }

  if (!data) return null;
  // Ancien rôle manager_chauffeur (plus attribuable) : manager qui conduit.
  const brut = data as unknown as Omit<AppUser, "conduit" | "can_drive" | "role"> & { role: string; can_drive?: boolean | null };
  const ancien = brut.role === "manager_chauffeur";
  const role = (ancien ? "manager" : brut.role) as UserRole;
  const canDrive = ancien || Boolean(brut.can_drive);
  return { ...brut, role, can_drive: canDrive, conduit: estConducteur(role, canDrive) };
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
