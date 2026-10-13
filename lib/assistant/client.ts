import "server-only";
import { z } from "zod";
import { paysDe } from "@/lib/pays/pays";
import { ASSISTANT_SYSTEM_PROMPT, SUMMARY_SYSTEM_PROMPT } from "@/lib/assistant/system-prompt";
import type { HelpSource } from "@/lib/assistant/help-content";

const assistantResponseSchema = z.object({
  answer: z.string(),
  needs_human: z.boolean(),
  reason: z.string().nullable(),
});

export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export type AssistantResult = { ok: true; response: AssistantResponse } | { ok: false; reason: string };

export interface AssistantContext {
  role: string;
  serviceNames: string[];
  enabledModuleKeys: string[];
  emergencyPhone: string | null;
  /** Pays de l'entreprise : les réponses suivent son droit (données, temps de conduite, paie). */
  country?: string | null;
}

/** Rappel du pays pour que l'assistant n'applique pas le droit français partout. */
function paysContexte(code: string | null | undefined): string {
  const p = paysDe(code);
  return `Entreprise établie en ${p.nom} : pour les questions de droit, réponds selon ce pays (données personnelles : ${p.donnees.loi}, autorité ${p.donnees.autorite} ; temps de conduite : ${p.tempsConduite} ; paie : ${p.paie.organismes}) et renvoie vers l'employeur en cas de doute.`;
}

export interface AssistantHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Same plain-fetch-to-Messages-API style as lib/import/ai-extract.ts
 * and lib/vehicles/ai-specs.ts. Sources are the only "database" this
 * call ever sees — the static guide (role-filtered,
 * lib/assistant/help-content.ts) plus the organisation's own
 * assistant_notes (role-filtered, fetched by the caller) — never a
 * live query against fuel_entries/vehicles/users.
 */
export async function askAssistant({
  context,
  sources,
  history,
  message,
}: {
  context: AssistantContext;
  sources: HelpSource[];
  history: AssistantHistoryMessage[];
  message: string;
}): Promise<AssistantResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const sourcesText = sources.map((s) => `### ${s.title}\n${s.content}`).join("\n\n");
  const contextText = `Rôle de la personne : ${context.role}. Service(s) : ${context.serviceNames.join(", ") || "aucun"}. Modules activés : ${context.enabledModuleKeys.join(", ") || "aucun"}. ${paysContexte(context.country)}${context.emergencyPhone ? ` Numéro du responsable en cas d'urgence : ${context.emergencyPhone}.` : " Aucun numéro d'urgence configuré pour cette organisation."}`;

  const toolSchema = {
    type: "object" as const,
    properties: {
      answer: { type: "string" },
      needs_human: { type: "boolean" },
      reason: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["answer", "needs_human", "reason"],
  };

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: `${ASSISTANT_SYSTEM_PROMPT}\n\nContexte :\n${contextText}\n\nSources disponibles :\n${sourcesText}`,
        messages: [...history.map((h) => ({ role: h.role, content: h.content })), { role: "user", content: message }],
        tools: [{ name: "assistant_reply", description: "La réponse de l'assistant.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "assistant_reply" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "assistant_reply");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = assistantResponseSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, response: parsed.data };
}

export type SummaryResult = { ok: true; summary: string } | { ok: false; reason: string };

/** Short recap attached to a support_requests row — see lib/assistant/system-prompt.ts's SUMMARY_SYSTEM_PROMPT. */
export async function summarizeConversation(history: AssistantHistoryMessage[]): Promise<SummaryResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }
  if (history.length === 0) {
    return { ok: true, summary: "" };
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 256,
        system: SUMMARY_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: history.map((h) => `${h.role === "user" ? "Salarié" : "Assistant"} : ${h.content}`).join("\n"),
          },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((c) => c.type === "text")?.text;
  if (!text) {
    return { ok: false, reason: "AI response did not contain a text summary" };
  }
  return { ok: true, summary: text.trim() };
}
