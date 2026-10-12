import { notFound } from "next/navigation";
import { requireAppUser } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/ui";
import { FaqManager, type FaqEntry } from "@/components/assistant/FaqManager";

/** GODAC-level curation of the shared FAQ — platform admins only. */
export default async function AdminFaqPage() {
  const appUser = await requireAppUser();
  if (!(await isPlatformAdmin(appUser.id))) notFound();

  const admin = createAdminSupabaseClient();
  const [{ data: rows }, { count: pendingLogs }, { count: pendingResolved }] = await Promise.all([
    admin.from("assistant_faq").select("id, question, answer, roles, status, asked_count"),
    admin.from("assistant_question_log").select("id", { count: "exact", head: true }).is("processed_at", null),
    admin
      .from("support_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "resolved")
      .not("response", "is", null)
      .is("faq_processed_at", null),
  ]);

  const entries: FaqEntry[] = (rows ?? []).map((r) => ({
    id: r.id,
    question: r.question,
    answer: r.answer,
    roles: r.roles ?? [],
    status: r.status,
    askedCount: r.asked_count,
  }));

  return (
    <div>
      <PageHeader
        title="FAQ de l'assistant"
        description="Les questions posées à l'assistant par les salariés de toutes les entreprises, anonymisées. Validez les réponses : une fois publiées, tous les assistants s'en servent et elles apparaissent dans « Questions fréquentes »."
      />
      <FaqManager entries={entries} pendingQuestions={(pendingLogs ?? 0) + (pendingResolved ?? 0)} />
    </div>
  );
}
