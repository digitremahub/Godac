import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";

/**
 * GODAC's own cross-tenant backoffice (Module 9): every client
 * organisation, its plan and Stripe status, at a glance. Deliberately
 * separate from the (dashboard) route group — a client's `direction`
 * role only ever sees their own org via RLS; this page bypasses RLS
 * on purpose via the service-role client, so access is gated by the
 * GODAC_STAFF_EMAILS allowlist instead (see lib/godac-staff/auth.ts).
 */
export default async function GodacStaffPage() {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const email = user?.email;

  if (!isGodacStaffEmail(email)) {
    redirect("/dashboard");
  }

  const supabase = createAdminSupabaseClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, name, plan, subscription_status, ocr_enabled, created_at, vehicles(count), users(count)")
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-navy p-6">
      <PageHeader
        title="GODAC — Backoffice opérateur"
        description={`Connecté en tant que ${email}. Vue cross-tenant, hors RLS — usage interne uniquement.`}
      />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-white/40">
            <tr>
              <th className="pb-2">Organisation</th>
              <th className="pb-2">Plan</th>
              <th className="pb-2">Abonnement</th>
              <th className="pb-2">OCR</th>
              <th className="pb-2">Véhicules</th>
              <th className="pb-2">Utilisateurs</th>
              <th className="pb-2">Créée le</th>
            </tr>
          </thead>
          <tbody>
            {(organizations ?? []).map((org: any) => (
              <tr key={org.id} className="border-t border-white/5">
                <td className="py-2">{org.name}</td>
                <td className="py-2 capitalize">{org.plan}</td>
                <td className="py-2">
                  <span className={org.subscription_status === "active" ? "badge-teal" : "badge-gold"}>
                    {org.subscription_status}
                  </span>
                </td>
                <td className="py-2">{org.ocr_enabled ? "Activé" : "Désactivé"}</td>
                <td className="py-2">{org.vehicles?.[0]?.count ?? 0}</td>
                <td className="py-2">{org.users?.[0]?.count ?? 0}</td>
                <td className="py-2">{new Date(org.created_at).toLocaleDateString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
