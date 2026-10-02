import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { createSupportRequest } from "@/lib/assistant/create-support-request";
import type { AssistantHistoryMessage } from "@/lib/assistant/client";
import { MAX_HISTORY_MESSAGES } from "@/lib/assistant/rate-limit";

/** The explicit "Parler à quelqu'un" button — one of the three relay triggers (see app/api/assistant/message's own comment for the other two). */
export async function POST() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  const assistantEnabled = await isModuleEnabled(supabase, appUser.organization_id, "assistant");
  if (!assistantEnabled) {
    return NextResponse.json({ error: "Module assistant non activé" }, { status: 403 });
  }

  const { data: conversation } = await supabase
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", appUser.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: historyRows } = conversation
    ? await supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: false })
        .limit(MAX_HISTORY_MESSAGES)
    : { data: [] };
  const history: AssistantHistoryMessage[] = (historyRows ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.content ?? "Demande transmise depuis l'assistant.";

  const relay = await createSupportRequest({
    supabase,
    appUser,
    question: lastUserMessage,
    conversationId: conversation?.id ?? null,
    history,
  });

  return NextResponse.json({ relay });
}
