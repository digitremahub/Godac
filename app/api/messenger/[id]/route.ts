import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Lets a sender delete their own message. RLS ("messages: sender
 * deletes own") would reject anyone else's delete anyway, but
 * checking here first gives a clean 404 instead of a bare RLS
 * failure, same convention as app/api/messenger/send/route.ts's
 * recipient check.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data: message } = await supabase.from("messages").select("id, sender_id, photo_path").eq("id", id).maybeSingle();
  if (!message || message.sender_id !== appUser.id) {
    return NextResponse.json({ error: "Message introuvable." }, { status: 404 });
  }

  if (message.photo_path) {
    await supabase.storage.from("messenger-photos").remove([message.photo_path]);
  }

  const { error } = await supabase.from("messages").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
