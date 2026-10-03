import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppUser } from "@/lib/auth/session";

/**
 * Who may approve/reject a given pending self-signup: direction can
 * act on anyone in their org; a chef de service/responsable
 * exploitation (manager/manager_chauffeur) can act on a driver who
 * picked one of their own services, or picked none at all (so nobody
 * self-registering without a service ends up stuck unapprovable).
 * users RLS is direction-only for writes (see "users: direction
 * manages members"), so the two API routes that call this write via
 * the service-role client after this check — the same
 * validate-in-app-code-then-admin-write pattern as support-requests
 * and driver-pin.
 */
export async function canManagePendingDriver(
  supabase: SupabaseClient,
  appUser: AppUser,
  targetUserId: string,
): Promise<boolean> {
  if (appUser.role === "direction") return true;
  if (appUser.role !== "manager" && appUser.role !== "manager_chauffeur") return false;

  const [{ data: targetServices }, { data: myServices }] = await Promise.all([
    supabase.from("user_services").select("service_id").eq("user_id", targetUserId),
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
  ]);

  if (!targetServices || targetServices.length === 0) return true;
  const mine = new Set((myServices ?? []).map((s) => s.service_id));
  return targetServices.some((s) => mine.has(s.service_id));
}
