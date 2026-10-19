import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * Polled by the floating chat widget (no realtime infra in this
 * codebase) to know which conversations have something new waiting —
 * drives both the bubble's unread badge and auto-(re)opening a tab
 * for a sender the viewer doesn't currently have open.
 */
export async function GET() {
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const messengerEnabled = await isModuleEnabled(supabase, appUser.organization_id, "messenger");
  if (!messengerEnabled) return NextResponse.json({ senders: [] });

  const { data, error } = await supabase
    .from("messages")
    .select("sender_id, created_at, users!messages_sender_id_fkey(full_name)")
    .eq("recipient_id", appUser.id)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const bySender = new Map<string, { id: string; full_name: string; unreadCount: number }>();
  for (const row of (data ?? []) as any[]) {
    const existing = bySender.get(row.sender_id);
    if (existing) existing.unreadCount += 1;
    else bySender.set(row.sender_id, { id: row.sender_id, full_name: row.users?.full_name ?? "—", unreadCount: 1 });
  }

  return NextResponse.json({ senders: Array.from(bySender.values()) });
}
