import "server-only";
import webpush from "web-push";
import { lienAbsolu } from "@/lib/push/lien";
import type { SupabaseClient } from "@supabase/supabase-js";

let configured = false;

/** Returns false (and leaves push silently unsent) when the VAPID keys aren't set — same degrade-cleanly convention as lib/email/resend.ts. */
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:notifications@godac.app", publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

interface Subscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Sends one push notification per subscription row (a user with two
 * devices gets two pushes). A subscription the browser has revoked
 * comes back as HTTP 404/410 from the push service — deleted here
 * rather than retried, same as how the OCR/email paths never retry a
 * permanent failure.
 */
export async function sendPushToSubscriptions(
  supabase: SupabaseClient,
  subscriptions: Subscription[],
  payload: PushPayload,
): Promise<{ sent: number }> {
  if (!ensureConfigured() || subscriptions.length === 0) return { sent: 0 };

  // Lien absolu vers godac.app : un abonnement créé sur un autre hôte (godac-v2.vercel.app) ouvrirait sinon cet hôte-là.
  const body = JSON.stringify({ ...payload, url: lienAbsolu(payload.url) });
  let sent = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
        sent++;
      } catch (err) {
        const statusCode = (err as { statusCode?: number } | null)?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.warn(`sendPushToSubscriptions: failed for subscription ${sub.id}`, err);
        }
      }
    }),
  );

  return { sent };
}
