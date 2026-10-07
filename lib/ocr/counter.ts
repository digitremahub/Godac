import "server-only";
import { z } from "zod";

/**
 * Reads a bare digit counter photo via Claude vision — a vehicle's
 * odometer/dashboard, or a fuel pump/tank totalizer. Replaces the
 * Mindee custom-model path (lib/ocr/mindee.ts, removed), which had
 * no generic-model fallback at all and needed a model trained in
 * Mindee Studio before it could read anything. This needs no
 * separate account or training — same Claude vision call as
 * lib/ocr/tour-report.ts, just reading one number instead of a
 * whole form.
 */

export type CounterKind = "odometer" | "totalizer";

const SYSTEM_PROMPTS: Record<CounterKind, string> = {
  odometer:
    "Tu lis le compteur kilométrique (tableau de bord) d'un véhicule sur une photo. Renvoie uniquement le kilométrage total affiché, en kilomètres, sous forme de nombre entier. Si le chiffre n'est pas clairement lisible, renvoie null plutôt que de deviner.",
  totalizer:
    "Tu lis l'afficheur numérique d'un totalisateur de pompe ou de cuve à carburant sur une photo (l'index cumulé en litres, jamais le prix). Renvoie uniquement ce nombre, en litres. Si le chiffre n'est pas clairement lisible, renvoie null plutôt que de deviner.",
};

export type CounterOcrResult = { ok: true; reading: number | null } | { ok: false; reason: string };

const imageMediaTypeFromFilename = (filename: string): string => {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
};

async function extractCounterReading(imageBytes: Buffer, filename: string, kind: CounterKind): Promise<CounterOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const toolSchema = {
    type: "object" as const,
    properties: { reading: { anyOf: [{ type: "number" }, { type: "null" }] } },
    required: ["reading"],
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
        max_tokens: 256,
        system: SYSTEM_PROMPTS[kind],
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: imageMediaTypeFromFilename(filename), data: imageBytes.toString("base64") },
              },
              { type: "text", text: "Lis le chiffre affiché via l'outil fourni." },
            ],
          },
        ],
        tools: [{ name: "counter_reading", description: "Le chiffre lu sur le compteur.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "counter_reading" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "counter_reading");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = z.object({ reading: z.number().nonnegative().nullable() }).safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, reading: parsed.data.reading };
}

export function extractOdometerReading(imageBytes: Buffer, filename: string): Promise<CounterOcrResult> {
  return extractCounterReading(imageBytes, filename, "odometer");
}

export function extractTotalizerReading(imageBytes: Buffer, filename: string): Promise<CounterOcrResult> {
  return extractCounterReading(imageBytes, filename, "totalizer");
}
