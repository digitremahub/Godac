import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { renderAlertEmail } from "@/lib/email/templates/alert-notification";
import type { UserRole } from "@/lib/types/domain";

/**
 * Receiver for a Supabase Database Webhook configured on
 * `insert on public.alerts` (Dashboard > Database > Webhooks — this
 * is the piece that can't be created from a SQL migration, see
 * README "Intégrations non branchées"). Resolves recipient emails
 * from `alerts.recipient_roles` and sends via Resend.
 *
 * Protected by a shared secret header rather than svix (Supabase DB
 * webhooks let you set arbitrary headers, unlike Clerk/Stripe which
 * sign their own payloads).
 */
export async function POST(req: Request) {
  const expectedSecret = process.env.SUPABASE_DB_WEBHOOK_SECRET;
  if (!expectedSecret) {
    console.error("SUPABASE_DB_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }
  if (req.headers.get("x-webhook-secret") !== expectedSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const payload = await req.json();
  const alert = payload.record as {
    id: string;
    organization_id: string;
    type: string;
    severity: string;
    message: string;
    recipient_roles: UserRole[];
  };

  const supabase = createAdminSupabaseClient();

  const [{ data: organization }, { data: recipients }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", alert.organization_id).single(),
    supabase
      .from("users")
      .select("email")
      .eq("organization_id", alert.organization_id)
      .eq("active", true)
      .in("role", alert.recipient_roles.length > 0 ? alert.recipient_roles : ["direction"]),
  ]);

  const { subject, html } = renderAlertEmail({
    type: alert.type,
    severity: alert.severity,
    message: alert.message,
    organizationName: organization?.name ?? "GODAC",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  });

  const result = await sendTransactionalEmail({
    to: (recipients ?? []).map((r) => r.email),
    subject,
    html,
  });

  if (result.sent) {
    await supabase.from("alerts").update({ notified_at: new Date().toISOString() }).eq("id", alert.id);
  } else {
    console.warn(`Alert ${alert.id} not emailed: ${result.reason}`);
  }

  return NextResponse.json({ emailed: result.sent, reason: result.reason });
}
