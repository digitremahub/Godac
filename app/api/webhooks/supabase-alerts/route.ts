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
 * Protected by a shared secret header rather than a signed payload
 * (Supabase DB webhooks let you set arbitrary headers, unlike
 * Stripe's webhooks, which sign their own payloads).
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
    recipient_user_id: string | null;
  };

  const supabase = createAdminSupabaseClient();

  const [{ data: organization }, { data: recipients }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", alert.organization_id).single(),
    alert.recipient_user_id
      ? supabase.from("users").select("email, contact_email, auth_method").eq("id", alert.recipient_user_id).eq("active", true)
      : supabase
          .from("users")
          .select("email, contact_email, auth_method")
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

  // A badge+PIN driver's own `email` is a fabricated address that's
  // never delivered (see lib/auth/driver-pin.ts) — it only exists to
  // serve as their Supabase Auth identifier. Without a contact_email
  // on file, there's simply no address to send to; sending to the
  // fabricated one would just bounce.
  const addresses = (recipients ?? [])
    .map((r) => r.contact_email ?? (r.auth_method === "pin" ? null : r.email))
    .filter((email): email is string => Boolean(email));

  const result = await sendTransactionalEmail({
    to: addresses,
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
