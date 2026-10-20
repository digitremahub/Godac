import { garderPage } from "@/lib/acces/garde-page";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { SupportRequestsList } from "@/components/assistant/SupportRequestsList";

/**
 * Manager-like inbox for the assistant's human relay. Same
 * query-level service-scoping convention as /flotte/badges and the
 * dashboard's "tournées en cours" widget (see their own comments) —
 * direction sees every request, manager/manager_chauffeur only those
 * from their own service(s) — rather than a new RLS policy, to avoid
 * widening support_requests' org-wide manager-like SELECT policy.
 */
export default async function SupportPage() {
  const g = await garderPage("communication.assistance");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;

  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("support_requests")
    .select("id, question, conversation_summary, recipient, status, response, service_id, created_at, users!support_requests_requested_by_fkey(full_name)")
    .order("created_at", { ascending: false });

  if (appUser.role !== "direction") {
    const { data: myServices } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
    const serviceIds = (myServices ?? []).map((s) => s.service_id);
    query = query.in("service_id", serviceIds.length > 0 ? serviceIds : ["00000000-0000-0000-0000-000000000000"]);
  }

  const { data: requests } = await query;

  return (
    <div>
      <PageHeader title="Demandes d'assistance" description="Questions relayées par l'assistant vers un humain." />
      <SupportRequestsList
        requests={(requests ?? []).map((r: any) => ({
          id: r.id,
          question: r.question,
          conversationSummary: r.conversation_summary,
          recipient: r.recipient,
          status: r.status,
          response: r.response,
          createdAt: r.created_at,
          requesterName: r.users?.full_name ?? "—",
        }))}
        canAddToNotes={appUser.role === "direction"}
      />
    </div>
  );
}
