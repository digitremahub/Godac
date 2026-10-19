import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";

/**
 * Powers the floating chat widget's conversation tabs (the full
 * /messenger page does this same fetch + sign + mark-read inline
 * server-side instead, since it already has a server-rendered page).
 * Opening a thread marks the other side's messages read — same
 * "reading it is marking it read" semantics either way in.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["messenger"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const messengerEnabled = await isModuleEnabled(supabase, appUser.organization_id, "messenger");
  if (!messengerEnabled) return NextResponse.json({ error: "Module Messenger non activé." }, { status: 403 });

  const contactId = new URL(req.url).searchParams.get("with");
  if (!contactId) return NextResponse.json({ error: "Paramètre 'with' requis." }, { status: 400 });

  const { data: contact } = await supabase
    .from("users")
    .select("id")
    .eq("id", contactId)
    .eq("organization_id", appUser.organization_id)
    .maybeSingle();
  if (!contact) return NextResponse.json({ error: "Destinataire introuvable." }, { status: 404 });

  await supabase.from("messages").update({ read_at: new Date().toISOString() }).eq("sender_id", contactId).eq("recipient_id", appUser.id).is("read_at", null);

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, sender_id, recipient_id, body, photo_path, created_at")
    .or(`and(sender_id.eq.${appUser.id},recipient_id.eq.${contactId}),and(sender_id.eq.${contactId},recipient_id.eq.${appUser.id})`)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const withUrls = await Promise.all(
    (messages ?? []).map(async (m) => {
      if (!m.photo_path) return { ...m, photoUrl: null };
      const { data } = await supabase.storage.from("messenger-photos").createSignedUrl(m.photo_path, 600);
      return { ...m, photoUrl: data?.signedUrl ?? null };
    }),
  );

  return NextResponse.json({ messages: withUrls });
}
