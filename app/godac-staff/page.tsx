import { redirect } from "next/navigation";
import Link from "next/link";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { PageHeader, Card } from "@/components/ui";
import { StaffSupportRequestsList } from "@/components/godac-staff/StaffSupportRequestsList";
import { essaiTermine, estOffreGoNavigation } from "@/lib/go-navigation/offre";

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
  const colonnesOrg = "id, name, plan, subscription_status, created_at, vehicles(count), users(count)";
  const lireOrganisations = (colonnes: string) => supabase.from("organizations").select(colonnes).order("created_at", { ascending: false });
  const [{ data: organizations }, { data: ocrRows }, { data: supportRequests }, { data: demandesDemo }] = await Promise.all([
    // Colonne offre absente (migration 20261023000003 non appliquée) : liste sans badge GO Navigation.
    lireOrganisations(`${colonnesOrg}, offre, trial_ends_at`).then((r) => (r.error?.code === "42703" ? lireOrganisations(colonnesOrg) : r)),
    supabase.from("organization_modules").select("organization_id, enabled").eq("module_key", "ocr"),
    supabase
      .from("support_requests")
      .select("id, question, status, created_at, organizations(name)")
      .eq("recipient", "support_godac")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("demo_requests")
      .select("id, full_name, company, email, phone, vehicles, activity, message, plan_interest, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const ocrByOrg = new Map((ocrRows ?? []).map((r) => [r.organization_id as string, r.enabled as boolean]));

  return (
    <main className="min-h-screen p-6">
      <PageHeader
        title="GODAC — Backoffice opérateur"
        description={`Connecté en tant que ${email}. Vue cross-tenant, hors RLS — usage interne uniquement.`}
      />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="text-left text-navy/60">
            <tr>
              <th className="pb-2">Organisation</th>
              <th className="pb-2">Plan</th>
              <th className="pb-2">Abonnement</th>
              <th className="pb-2">OCR</th>
              <th className="pb-2">Véhicules</th>
              <th className="pb-2">Utilisateurs</th>
              <th className="pb-2">Créée le</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {(organizations ?? []).map((org: any) => (
              <tr key={org.id} className="border-t border-navy/5">
                <td className="py-2">
                  {org.name}
                  {estOffreGoNavigation(org) && (
                    <span className={`ml-2 ${essaiTermine(org) ? "badge-gold" : "badge-teal"}`}>
                      GO Navigation – {essaiTermine(org) ? "essai terminé" : "essai"}
                    </span>
                  )}
                </td>
                <td className="py-2 capitalize">{org.plan}</td>
                <td className="py-2">
                  <span className={org.subscription_status === "active" ? "badge-teal" : "badge-gold"}>
                    {org.subscription_status}
                  </span>
                </td>
                <td className="py-2">{ocrByOrg.get(org.id) ? "Activé" : "Désactivé"}</td>
                <td className="py-2">{org.vehicles?.[0]?.count ?? 0}</td>
                <td className="py-2">{org.users?.[0]?.count ?? 0}</td>
                <td className="py-2">{new Date(org.created_at).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}</td>
                <td className="py-2">
                  <Link href={`/godac-staff/${org.id}`} className="text-teal-ink hover:underline">
                    Utilisateurs / rôles
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="mt-6">
        <h2 className="mb-2 text-lg">Demandes de démo (site public)</h2>
        <Card className="overflow-x-auto">
          {(demandesDemo ?? []).length === 0 ? (
            <p className="text-sm text-navy/60">Aucune demande pour l&apos;instant.</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-navy/60">
                <tr>
                  <th className="pb-2">Reçue le</th>
                  <th className="pb-2">Entreprise</th>
                  <th className="pb-2">Contact</th>
                  <th className="pb-2">Véhicules</th>
                  <th className="pb-2">Besoin</th>
                </tr>
              </thead>
              <tbody>
                {(demandesDemo ?? []).map((d: any) => (
                  <tr key={d.id} className="border-t border-navy/5 align-top">
                    <td className="py-2">{new Date(d.created_at).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="py-2">
                      {d.company}
                      {d.activity && <span className="block text-xs text-navy/55">{d.activity}</span>}
                    </td>
                    <td className="py-2">
                      {d.full_name}
                      <a href={`mailto:${d.email}`} className="block text-xs text-teal-ink hover:underline">
                        {d.email}
                      </a>
                      {d.phone && (
                        <a href={`tel:${d.phone}`} className="block text-xs text-teal-ink hover:underline">
                          {d.phone}
                        </a>
                      )}
                    </td>
                    <td className="py-2">{d.vehicles ?? "—"}</td>
                    <td className="py-2 text-xs">
                      {d.plan_interest && <span className="badge-teal mr-1 capitalize">{d.plan_interest}</span>}
                      {d.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-lg">Demandes d&apos;assistance transmises au support GODAC</h2>
        <StaffSupportRequestsList
          requests={(supportRequests ?? []).map((r: any) => ({
            id: r.id,
            question: r.question,
            status: r.status,
            createdAt: r.created_at,
            organizationName: r.organizations?.name ?? "—",
          }))}
        />
      </div>
    </main>
  );
}
