import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTransactionalEmail } from "@/lib/email/resend";
import { classifySupportCategory, determineSupportRecipient } from "@/lib/assistant/routing";
import { summarizeConversation, type AssistantHistoryMessage } from "@/lib/assistant/client";
import type { AppUser } from "@/lib/auth/session";

export interface SupportRequestOutcome {
  recipientLabel: "votre responsable" | "le support GODAC";
  emergencyPhone: string | null;
}

/**
 * Shared by the three relay triggers (needs_human from the AI, the
 * explicit "Parler à quelqu'un" button, two consecutive 👎) — see
 * app/api/assistant/message, /escalate and /feedback. A
 * `support_godac` request never goes through the alerts/email-webhook
 * pipeline (alerts are organization-scoped, GODAC staff isn't a
 * tenant member — see migration 055's comment); it's emailed directly
 * here to GODAC_STAFF_EMAILS instead, and still visible to GODAC
 * staff in app/godac-staff.
 */
export async function createSupportRequest({
  supabase,
  appUser,
  question,
  conversationId,
  history,
}: {
  supabase: SupabaseClient;
  appUser: AppUser;
  question: string;
  conversationId: string | null;
  history: AssistantHistoryMessage[];
}): Promise<SupportRequestOutcome> {
  const category = classifySupportCategory(question);
  const recipient = determineSupportRecipient(appUser.role, category);

  const [{ data: userService }, { data: organization }] = await Promise.all([
    supabase.from("user_services").select("service_id").eq("user_id", appUser.id).limit(1).maybeSingle(),
    supabase.from("organizations").select("name, emergency_phone").eq("id", appUser.organization_id).single(),
  ]);

  const summaryResult = await summarizeConversation(history);
  const conversationSummary = summaryResult.ok ? summaryResult.summary || null : null;

  const { data: created, error } = await supabase
    .from("support_requests")
    .insert({
      organization_id: appUser.organization_id,
      requested_by: appUser.id,
      service_id: userService?.service_id ?? null,
      conversation_id: conversationId,
      question,
      conversation_summary: conversationSummary,
      recipient,
    })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Création de la demande d'assistance échouée: ${error.message}`);
  }

  if (recipient === "support_godac") {
    const staffEmails = (process.env.GODAC_STAFF_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    await sendTransactionalEmail({
      to: staffEmails,
      subject: `[GODAC Support] Nouvelle demande — ${organization?.name ?? "organisation inconnue"}`,
      html: `<p><strong>${appUser.full_name}</strong> (${organization?.name ?? "?"}) :</p><p>${escapeHtml(question)}</p>${
        conversationSummary ? `<p><em>${escapeHtml(conversationSummary)}</em></p>` : ""
      }`,
    });
  }

  return {
    recipientLabel: recipient === "support_godac" ? "le support GODAC" : "votre responsable",
    emergencyPhone: organization?.emergency_phone ?? null,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}
