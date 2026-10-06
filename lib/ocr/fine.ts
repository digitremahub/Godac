import "server-only";
import { z } from "zod";

/**
 * Reads a photo of a traffic fine notice ("avis de contravention") —
 * same Claude-vision, never-throw approach as lib/ocr/tour-report.ts
 * (no Mindee model exists for this document either). Extracts just
 * enough to prefill the creation form in /fines; the vehicle plate is
 * resolved against the org's own fleet server-side (see
 * app/api/fines/route.ts), never trusted as a direct id from the
 * photo.
 */

const fieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) => valueSchema.nullable();

export const fineSchema = z.object({
  registration: fieldSchema(z.string()),
  infraction_date: fieldSchema(z.string()), // "YYYY-MM-DD"
  infraction_time: fieldSchema(z.string()), // "HH:MM"
  amount: fieldSchema(z.number().nonnegative()),
  reference: fieldSchema(z.string()),
});

export type FineFields = z.infer<typeof fineSchema>;

export type FineOcrResult = { ok: true; fields: FineFields } | { ok: false; reason: string };

const SYSTEM_PROMPT = `Tu lis une photo d'un avis de contravention (amende routière). Extrais uniquement les informations explicitement lisibles sur la photo — ne devine jamais une valeur absente ou floue, renvoie null dans ce cas. Champs : plaque d'immatriculation du véhicule verbalisé, date de l'infraction (format YYYY-MM-DD), heure de l'infraction (format HH:MM), montant de l'amende en euros (nombre), numéro de référence/dossier de l'avis.`;

const imageMediaTypeFromFilename = (filename: string): string => {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
};

export async function extractFineFromImage(imageBytes: Buffer, filename: string): Promise<FineOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const toolSchema = {
    type: "object" as const,
    properties: {
      registration: { anyOf: [{ type: "string" }, { type: "null" }] },
      infraction_date: { anyOf: [{ type: "string" }, { type: "null" }] },
      infraction_time: { anyOf: [{ type: "string" }, { type: "null" }] },
      amount: { anyOf: [{ type: "number" }, { type: "null" }] },
      reference: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["registration", "infraction_date", "infraction_time", "amount", "reference"],
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
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: imageMediaTypeFromFilename(filename), data: imageBytes.toString("base64") },
              },
              { type: "text", text: "Extrais les champs de cet avis de contravention via l'outil fourni." },
            ],
          },
        ],
        tools: [{ name: "fine", description: "Champs extraits de l'avis de contravention.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "fine" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "fine");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = fineSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, fields: parsed.data };
}
