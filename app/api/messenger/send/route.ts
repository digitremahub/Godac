import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isModuleEnabled } from "@/lib/organization/modules";

const bodySchema = z
  .object({
    recipient_id: z.string().uuid(),
    body: z.string().trim().max(4000).optional(),
    photo_path: z.string().optional(),
  })
  .refine((data) => Boolean(data.body) || Boolean(data.photo_path), { message: "Message vide." });

export async function POST(req: Request) {
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
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

  // Storage RLS already confines the upload to this folder, but a
  // garbage path here would still get stored as a dangling reference.
  if (parsed.data.photo_path && !parsed.data.photo_path.startsWith(`${appUser.organization_id}/${appUser.id}/`)) {
    return NextResponse.json({ error: "Chemin de photo invalide." }, { status: 400 });
  }

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      organization_id: appUser.organization_id,
      sender_id: appUser.id,
      recipient_id: parsed.data.recipient_id,
      body: parsed.data.body ?? null,
      photo_path: parsed.data.photo_path ?? null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Messenger had no notification at all until now — a recipient only
  // found out about a message by opening /communication/messenger on their own.
  // related_id is the sender's id, not the message's, so the "Voir →"
  // link (and the push tap target) opens straight into that thread
  // (see lib/alerts/resolve-url.ts's new_message override) rather than
  // a message-by-id view that doesn't exist.
  // alerts has no insert policy for authenticated clients at all — only
  // security-definer triggers and service-role crons write to it (see
  // app/api/planning/validate/route.ts for the same constraint) — the
  // admin client is required here, not the sender's own RLS-scoped one.
  const truncatedBody = !parsed.data.body
    ? "📷 Photo"
    : parsed.data.body.length > 120
      ? `${parsed.data.body.slice(0, 117)}...`
      : parsed.data.body;
  const admin = createAdminSupabaseClient();
  const { error: alertError } = await admin.from("alerts").insert({
    organization_id: appUser.organization_id,
    type: "new_message",
    severity: "info",
    message: `${appUser.full_name} vous a envoyé un message : ${truncatedBody}`,
    related_table: "messages",
    related_id: appUser.id,
    recipient_user_id: parsed.data.recipient_id,
  });
  if (alertError) console.warn(`messenger/send: alert insert failed: ${alertError.message}`);

  return NextResponse.json({ ok: true, messageId: message.id });
}
