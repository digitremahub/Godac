import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * One running conversation per user (get-or-create) — simpler than
 * letting people start a new thread, and fine for an assistant with
 * no concept of "topics": see RLS "assistant_conversations: own only"
 * for why a second user can never read into this.
 */
export async function GET() {
  const appUser = await requireAppUser();
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

  const { data: messages, error: messagesError } = await supabase
    .from("assistant_messages")
    .select("id, role, content, needs_human, feedback, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true });
  if (messagesError) return NextResponse.json({ error: messagesError.message }, { status: 500 });

  return NextResponse.json({ conversationId: conversation.id, messages: messages ?? [] });
}
