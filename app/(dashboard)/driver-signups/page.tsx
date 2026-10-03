import { redirect } from "next/navigation";
import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { DriverSignupsList } from "@/components/admin/DriverSignupsList";

/**
 * Self-signups (app/join/[token]) waiting on a chef de service/
 * responsable exploitation or direction. Scoped the same way
 * lib/auth/driver-signup-scope.ts's canManagePendingDriver decides
 * who may act: direction sees everyone pending; a manager-like only
 * sees requests that picked one of their own services, or none at
 * all — never a teammate's request for another service.
 */
export default async function DriverSignupsPage() {
  const appUser = await requireAppUser();
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) {
    redirect("/dashboard");
  }

  const supabase = await createServerSupabaseClient();
  const isDirection = appUser.role === "direction";

  const [{ data: pending }, { data: myServiceRows }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, phone, created_at, user_services(service_id, services(name))")
      .eq("pending_approval", true)
      .order("created_at"),
    isDirection ? Promise.resolve({ data: null }) : supabase.from("user_services").select("service_id").eq("user_id", appUser.id),
  ]);

  const myServiceIds = new Set((myServiceRows ?? []).map((r) => r.service_id));
  const visible = (pending ?? []).filter((u: any) => {
    if (isDirection) return true;
    const services = u.user_services ?? [];
    if (services.length === 0) return true;
    return services.some((s: any) => myServiceIds.has(s.service_id));
  });

  return (
    <div>
      <PageHeader
        title="Chauffeurs à valider"
        description="Comptes créés par auto-inscription (badge/lien du dépôt) — en attente de validation."
      />
      {visible.length === 0 ? (
        <EmptyState title="Rien à valider" description="Aucune demande en attente pour l'instant." />
      ) : (
        <DriverSignupsList requests={visible as any} />
      )}
    </div>
  );
}
