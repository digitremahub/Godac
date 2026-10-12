import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled, getEnabledModuleKeys } from "@/lib/organization/modules";
import { getHelpSourcesForRole, type HelpSource } from "@/lib/assistant/help-content";
import { askAssistant, type AssistantHistoryMessage } from "@/lib/assistant/client";
import { isWithinMessageRateLimit, MAX_MESSAGE_LENGTH, MAX_HISTORY_MESSAGES } from "@/lib/assistant/rate-limit";
import { createSupportRequest } from "@/lib/assistant/create-support-request";
import { anonymizeQuestion, faqSourcesForRole, type FaqRow } from "@/lib/assistant/faq";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ message: z.string().min(1).max(MAX_MESSAGE_LENGTH) });

/**
 * Lot B's main turn: validates + rate-limits, builds the role-filtered
 * sources (static guide + this organisation's own assistant_notes —
 * never a live query against business tables), calls the AI, persists
 * both sides of the exchange, and auto-opens a support_requests row
 * the moment the model itself signals `needs_human` (one of the three
 * relay triggers — the other two are /escalate and /feedback).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const assistantEnabled = await isModuleEnabled(supabase, appUser.organization_id, "assistant");
  if (!assistantEnabled) {
    return NextResponse.json({ error: "Module assistant non activé" }, { status: 403 });
  }

  let { data: conversation } = await supabase
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", appUser.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!conversation) {
    const { data: created, error } = await supabase
      .from("assistant_conversations")
      .insert({ organization_id: appUser.organization_id, user_id: appUser.id })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    conversation = created;
  }

  const { data: recentUserMessages } = await supabase
    .from("assistant_messages")
    .select("created_at")
    .eq("conversation_id", conversation.id)
    .eq("role", "user")
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (!isWithinMessageRateLimit((recentUserMessages ?? []).map((m) => new Date(m.created_at)))) {
    return NextResponse.json({ error: "Limite de 20 messages par heure atteinte — réessayez plus tard." }, { status: 429 });
  }

  const { data: historyRows } = await supabase
    .from("assistant_messages")
    .select("role, content")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);
  const history: AssistantHistoryMessage[] = (historyRows ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const [{ data: userServices }, { data: organization }, enabledModuleKeys] = await Promise.all([
    supabase.from("user_services").select("services(name)").eq("user_id", appUser.id),
    supabase.from("organizations").select("name, emergency_phone").eq("id", appUser.organization_id).single(),
    getEnabledModuleKeys(supabase, appUser.organization_id),
  ]);
  const serviceNames = (userServices ?? []).map((s: any) => s.services?.name).filter(Boolean);

  const { data: notes } = await supabase
    .from("assistant_notes")
    .select("title, content, roles")
    .eq("organization_id", appUser.organization_id);
  const visibleNotes: HelpSource[] = (notes ?? [])
    .filter((n) => n.roles.length === 0 || n.roles.includes(appUser.role))
    .map((n) => ({ title: n.title, content: n.content }));

  // Shared FAQ, curated from every organisation's (anonymised) questions.
  const { data: faqRows } = await supabase.from("assistant_faq").select("question, answer, roles").eq("status", "published");

  const sources = [...getHelpSourcesForRole(appUser.role), ...visibleNotes, ...faqSourcesForRole((faqRows ?? []) as FaqRow[], appUser.role)];

  const result = await askAssistant({
    context: { role: appUser.role, serviceNames, enabledModuleKeys, emergencyPhone: organization?.emergency_phone ?? null },
    sources,
    history,
    message: parsed.data.message,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 502 });
  }

  await supabase.from("assistant_messages").insert({ conversation_id: conversation.id, role: "user", content: parsed.data.message });
  const { data: assistantMessage, error: insertError } = await supabase
    .from("assistant_messages")
    .insert({
      conversation_id: conversation.id,
      role: "assistant",
      content: result.response.answer,
      needs_human: result.response.needs_human,
    })
    .select("id")
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  await supabase.from("assistant_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversation.id);

  // Feeds the shared FAQ: scrubbed text only, no organisation or user id.
  // A logging failure must never break the chat turn.
  try {
    await createAdminSupabaseClient()
      .from("assistant_question_log")
      .insert({ question: anonymizeQuestion(parsed.data.message, [appUser.full_name ?? "", organization?.name ?? ""]), role: appUser.role, answered: !result.response.needs_human });
  } catch (e) {
    console.error("assistant_question_log insert failed", e);
  }

  let relay: { recipientLabel: string; emergencyPhone: string | null } | null = null;
  if (result.response.needs_human) {
    relay = await createSupportRequest({
      supabase,
      appUser,
      question: parsed.data.message,
      conversationId: conversation.id,
      history: [...history, { role: "user", content: parsed.data.message }],
    });
  }

  return NextResponse.json({
    messageId: assistantMessage.id,
    answer: result.response.answer,
    needsHuman: result.response.needs_human,
    relay,
  });
}
