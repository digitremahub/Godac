import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z.object({
  recipient_id: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});

export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const messengerEnabled = await isModuleEnabled(supabase, appUser.organization_id, "messenger");
  if (!messengerEnabled) {
    return NextResponse.json({ error: "Module Messenger non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.recipient_id === appUser.id) {
    return NextResponse.json({ error: "Impossible de s'envoyer un message à soi-même." }, { status: 400 });
  }

  // Confirms the recipient is in the same org before the insert —
  // RLS would reject a cross-org id anyway (organization_id check),
  // but this gives a clean error instead of a generic insert failure.
  const { data: recipient } = await supabase
    .from("users")
    .select("id")
    .eq("id", parsed.data.recipient_id)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!recipient) {
    return NextResponse.json({ error: "Destinataire introuvable." }, { status: 404 });
  }

  const { error } = await supabase.from("messages").insert({
    organization_id: appUser.organization_id,
    sender_id: appUser.id,
    recipient_id: parsed.data.recipient_id,
    body: parsed.data.body,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
