import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";

const WINDOW_DAYS = 30;

/**
 * The notification bell (TopBar): the caller's latest alerts — broadcast
 * ones RLS lets them see plus their personal ones, never a colleague's
 * personal alert that a manager could otherwise read — with a per-user
 * read flag (alert_reads, so one manager reading doesn't clear it for
 * the others).
 */
export async function GET() {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString();

  const { data: alerts, error } = await supabase
    .from("alerts")
    .select("id, type, severity, message, created_at, related_table, related_id, recipient_user_id")
    .or(`recipient_user_id.is.null,recipient_user_id.eq.${appUser.id}`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (alerts ?? []).map((a) => a.id);
  const { data: reads } = ids.length
    ? await supabase.from("alert_reads").select("alert_id").eq("user_id", appUser.id).in("alert_id", ids)
    : { data: [] as { alert_id: string }[] };
  const readSet = new Set((reads ?? []).map((r) => r.alert_id));

  const items = (alerts ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    message: a.message,
    createdAt: a.created_at,
    href: resolveAlertUrl(a.related_table, a.type, a.related_id, { recipientUserId: a.recipient_user_id, role: appUser.role }) ?? "/communication/alertes",
    read: readSet.has(a.id),
  }));
  return NextResponse.json({ items, unread: items.filter((i) => !i.read).length });
}

const postSchema = z.object({ ids: z.array(z.string().uuid()).max(100) });

/** Marks notifications as read for the caller only. */
export async function POST(req: Request) {
  const g2 = await garderApi({ roles: "tous" });
  if (!g2.ok) return g2.reponse;
  const appUser = g2.appUser;
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  if (parsed.data.ids.length === 0) return NextResponse.json({ ok: true });

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("alert_reads")
    .upsert(parsed.data.ids.map((alert_id) => ({ alert_id, user_id: appUser.id })), { onConflict: "alert_id,user_id", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
