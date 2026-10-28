import "server-only";
import { Resend } from "resend";

let resendSingleton: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null; // Module 8 degrades to in-app-only notifications when unset.
  if (!resendSingleton) resendSingleton = new Resend(apiKey);
  return resendSingleton;
}

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string[];
  subject: string;
  html: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const client = getResendClient();
  if (!client) {
    return { sent: false, reason: "RESEND_API_KEY not configured — email skipped, in-app alert still created." };
  }
  if (to.length === 0) {
    return { sent: false, reason: "no recipients resolved for this alert" };
  }

  try {
    // Le SDK Resend ne lève pas d'exception sur un refus (domaine non vérifié, clé invalide…) : il renvoie { error }.
    const { error } = await client.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "GODAC <notifications@godac.app>",
      to,
      subject,
      html,
    });
    if (error) return { sent: false, reason: `${error.name ?? "resend_error"}: ${error.message}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: String(err) };
  }
}
