import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { renderAlertEmail } from "@/lib/email/templates/alert-notification";
import { sendPushToSubscriptions } from "@/lib/push/send";
import { resolveAlertUrl } from "@/lib/alerts/resolve-url";
import type { UserRole } from "@/lib/types/domain";
import { choisirDestinataires, rolesCibles, serviceAVerifier } from "@/lib/alerts/destinataires";

/**
 * Receiver for a Supabase Database Webhook configured on
 * `insert on public.alerts` (Dashboard > Database > Webhooks — this
 * is the piece that can't be created from a SQL migration, see
 * README "Intégrations non branchées"). Resolves recipients from
 * `alerts.recipient_roles`/`recipient_user_id` and notifies them on
 * two independent channels — email (Resend) and web push
 * (lib/push/send.ts, per-device opt-in from /account) — either one
 * succeeding marks the alert notified.
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
    related_table: string | null;
    related_id: string | null;
    service_id?: string | null;
  };

  const supabase = createAdminSupabaseClient();

  // Mode démo: alerts still appear in the app, but never leave it as
  // emails or push notifications (the demo accounts are fictional).
  const { data: demoCheck } = await supabase.from("organizations").select("is_demo").eq("id", alert.organization_id).maybeSingle();
  if (demoCheck?.is_demo) return NextResponse.json({ skipped: "demo" });

  const [{ data: organization }, { data: recipients }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", alert.organization_id).single(),
    alert.recipient_user_id
      ? supabase.from("users").select("id, role, email, contact_email, auth_method").eq("id", alert.recipient_user_id).eq("active", true)
      : supabase
          .from("users")
          .select("id, role, email, contact_email, auth_method")
          .eq("organization_id", alert.organization_id)
          .eq("active", true)
          // L'exploitation reçoit tout ce qui est destiné aux managers (lib/roles/perimetre.ts).
          .in("role", rolesCibles(alert.recipient_roles)),
  ]);

  // Alerte d'un service : le manager ne la reçoit que s'il est de ce service (même périmètre que la RLS) ;
  // exploitation et direction : toute l'organisation (lib/alerts/destinataires.ts).
  const candidats = recipients ?? [];
  const managersConcernes = candidats.filter((r) => serviceAVerifier(r.role, alert.type, alert.service_id)).map((r) => r.id);
  const { data: liensServices } = managersConcernes.length
    ? await supabase.from("user_services").select("user_id, service_id").in("user_id", managersConcernes)
    : { data: [] as { user_id: string; service_id: string }[] };
  const servicesDe = new Map<string, string[]>();
  for (const l of liensServices ?? []) servicesDe.set(l.user_id, [...(servicesDe.get(l.user_id) ?? []), l.service_id]);
  const destinataires = alert.recipient_user_id ? candidats : choisirDestinataires(candidats, alert, servicesDe);

  // Lien calculé PAR RÔLE destinataire (lib/alerts/resolve-url.ts) : une
  // même alerte peut ouvrir la gestion pour l'encadrement et la vue
  // personnelle pour un chauffeur. E-mail et push d'un même destinataire
  // ouvrent toujours la même page.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const parLien = new Map<string, typeof destinataires>();
  for (const r of destinataires) {
    const lien = resolveAlertUrl(alert.related_table, alert.type, alert.related_id, { recipientUserId: alert.recipient_user_id, role: r.role }) ?? "/communication/alertes";
    parLien.set(lien, [...(parLien.get(lien) ?? []), r]);
  }

  const resultats = await Promise.all(
    [...parLien.entries()].map(async ([linkPath, groupe]) => {
      const rendu = renderAlertEmail({
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        organizationName: organization?.name ?? "GODAC",
        appUrl,
        linkPath,
      });

      // A badge+PIN driver's own `email` is a fabricated address that's
      // never delivered (see lib/auth/driver-pin.ts) — it only exists to
      // serve as their Supabase Auth identifier. Without a contact_email
      // on file, there's simply no address to send to; sending to the
      // fabricated one would just bounce.
      const addresses = (groupe ?? [])
        .map((r) => r.contact_email ?? (r.auth_method === "pin" ? null : r.email))
        .filter((email): email is string => Boolean(email));

      const recipientIds = (groupe ?? []).map((r) => r.id);
      const { data: subscriptions } = recipientIds.length
        ? await supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", recipientIds)
        : { data: [] };

      const [email, push] = await Promise.all([
        addresses.length ? sendTransactionalEmail({ to: addresses, subject: rendu.subject, html: rendu.html }) : Promise.resolve<{ sent: boolean; reason?: string }>({ sent: false, reason: "no recipient address" }),
        sendPushToSubscriptions(supabase, subscriptions ?? [], { title: rendu.subject, body: alert.message, url: linkPath }),
      ]);
      return { email, push };
    }),
  );
  const emailResult = {
    sent: resultats.some((r) => r.email.sent),
    reason: resultats.length ? resultats.map((r) => r.email.reason).find(Boolean) : "no recipient",
  };
  const pushResult = { sent: resultats.reduce((n, r) => n + r.push.sent, 0) };

  if (emailResult.sent || pushResult.sent > 0) {
    await supabase.from("alerts").update({ notified_at: new Date().toISOString() }).eq("id", alert.id);
  }
  if (!emailResult.sent) {
    console.warn(`Alert ${alert.id} not emailed: ${emailResult.reason}`);
  }

  return NextResponse.json({ emailed: emailResult.sent, pushed: pushResult.sent, reason: emailResult.reason });
}
