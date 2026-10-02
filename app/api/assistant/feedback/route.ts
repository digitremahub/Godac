import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { shouldEscalateAfterFeedback } from "@/lib/assistant/escalation";
import { createSupportRequest } from "@/lib/assistant/create-support-request";
import type { AssistantHistoryMessage } from "@/lib/assistant/client";
import { MAX_HISTORY_MESSAGES } from "@/lib/assistant/rate-limit";

const bodySchema = z.object({ message_id: z.string().uuid(), useful: z.boolean() });

/** 👍/👎 on an assistant reply — two consecutive 👎 in the same conversation is one of the three relay triggers. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: message, error: messageError } = await supabase
    .from("assistant_messages")
    .select("id, conversation_id, role")
    .eq("id", parsed.data.message_id)
    .single();
  if (messageError || !message || message.role !== "assistant") {
    return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  }

  const { error: updateError } = await supabase
    .from("assistant_messages")
    .update({ feedback: parsed.data.useful })
    .eq("id", message.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const { data: recentAssistantMessages } = await supabase
    .from("assistant_messages")
    .select("feedback, content")
    .eq("conversation_id", message.conversation_id)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(2);
  const chronological = (recentAssistantMessages ?? []).slice().reverse();

  let relay: { recipientLabel: string; emergencyPhone: string | null } | null = null;
  if (shouldEscalateAfterFeedback(chronological.map((m) => m.feedback))) {
    // Avoid spamming a duplicate request if the last two negative
    // votes already triggered one moments ago (e.g. a double-click).
    const { data: recentRequest } = await supabase
      .from("support_requests")
      .select("id")
      .eq("conversation_id", message.conversation_id)
      .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .maybeSingle();
    if (!recentRequest) {
      const { data: historyRows } = await supabase
        .from("assistant_messages")
        .select("role, content")
        .eq("conversation_id", message.conversation_id)
        .order("created_at", { ascending: false })
        .limit(MAX_HISTORY_MESSAGES);
      const history: AssistantHistoryMessage[] = (historyRows ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      const lastUserMessage = [...history].reverse().find((m) => m.role === "user")?.content ?? chronological[chronological.length - 1]?.content ?? "Réponses jugées pas utiles par l'utilisateur.";

      relay = await createSupportRequest({
        supabase,
        appUser,
        question: lastUserMessage,
        conversationId: message.conversation_id,
        history,
      });
    }
  }

  return NextResponse.json({ relay });
}
