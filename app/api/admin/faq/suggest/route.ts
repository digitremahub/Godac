import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { isPlatformAdmin } from "@/lib/auth/platform";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { anonymizeQuestion, draftFaqEntries } from "@/lib/assistant/faq";
import { getAllHelpSources } from "@/lib/assistant/help-content";

export const maxDuration = 60;

/**
 * Drafts FAQ entries from the anonymised question log and the
 * resolved support requests of every organisation. Drafts land as
 * « suggested » — nothing reaches the assistants until published.
 */
export async function POST() {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!(await isPlatformAdmin(appUser.id))) return NextResponse.json({ error: "Accès réservé" }, { status: 403 });

  const admin = createAdminSupabaseClient();
  const [{ data: logs }, { data: resolved }, { data: existing }] = await Promise.all([
    admin.from("assistant_question_log").select("id, question, role, answered").is("processed_at", null).order("created_at").limit(300),
    admin
      .from("support_requests")
      .select("id, question, response")
      .eq("status", "resolved")
      .not("response", "is", null)
      .is("faq_processed_at", null)
      .limit(100),
    admin.from("assistant_faq").select("id, question, answer, status").neq("status", "dismissed"),
  ]);

  if (!logs?.length && !resolved?.length) {
    return NextResponse.json({ created: 0, updated: 0, message: "Aucune nouvelle question à analyser." });
  }

  const result = await draftFaqEntries({
    questions: (logs ?? []).map((l) => ({ question: l.question, role: l.role, answered: l.answered })),
    resolved: (resolved ?? []).map((r) => ({ question: anonymizeQuestion(r.question), response: anonymizeQuestion(r.response ?? "") })),
    guide: getAllHelpSources(),
    existing: (existing ?? []).map((e) => ({ id: e.id, question: e.question })),
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 502 });

  const byId = new Map((existing ?? []).map((e) => [e.id, e]));
  let created = 0;
  let updated = 0;
  for (const d of result.drafts) {
    const current = d.existing_id ? byId.get(d.existing_id) : undefined;
    if (current) {
      const { data: row } = await admin.from("assistant_faq").select("asked_count").eq("id", current.id).single();
      await admin
        .from("assistant_faq")
        .update({
          asked_count: (row?.asked_count ?? 0) + d.count,
          // Only fill a still-empty draft answer; never overwrite a reviewed one.
          ...(current.status === "suggested" && !current.answer && d.answer ? { answer: d.answer } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", current.id);
      updated++;
    } else {
      await admin.from("assistant_faq").insert({ question: d.question, answer: d.answer, roles: d.roles, asked_count: d.count, status: "suggested" });
      created++;
    }
  }

  const now = new Date().toISOString();
  if (logs?.length) await admin.from("assistant_question_log").update({ processed_at: now }).in("id", logs.map((l) => l.id));
  if (resolved?.length) await admin.from("support_requests").update({ faq_processed_at: now }).in("id", resolved.map((r) => r.id));

  return NextResponse.json({ created, updated, analysed: (logs?.length ?? 0) + (resolved?.length ?? 0) });
}
