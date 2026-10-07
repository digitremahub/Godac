import "server-only";
import { z } from "zod";

/**
 * Reads a fuel receipt photo via Claude vision — same approach as
 * lib/ocr/tour-report.ts and lib/ocr/fine.ts. Replaces the Mindee
 * integration (lib/ocr/mindee.ts, removed): no separate account, and
 * unlike Mindee's generic "financial_document" model (date/montant
 * only) this reads every field a French fuel ticket carries —
 * litres, prix unitaire, type de carburant included.
 */

const fieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) => valueSchema.nullable();

export const fuelReceiptSchema = z.object({
  date: fieldSchema(z.string()), // "YYYY-MM-DD"
  time: fieldSchema(z.string()), // "HH:MM"
  liters: fieldSchema(z.number().nonnegative()),
  unit_price: fieldSchema(z.number().nonnegative()),
  total_amount: fieldSchema(z.number().nonnegative()),
  station_name: fieldSchema(z.string()),
  fuel_type: fieldSchema(z.string()),
});

export type FuelReceiptFields = z.infer<typeof fuelReceiptSchema>;

export type FuelReceiptOcrResult = { ok: true; fields: FuelReceiptFields; raw: unknown } | { ok: false; reason: string };

const SYSTEM_PROMPT = `Tu lis une photo d'un ticket de caisse de station-service française (plein de carburant). Extrais uniquement les informations explicitement lisibles sur le ticket — ne devine jamais une valeur absente ou floue, renvoie null dans ce cas. Champs : date (format YYYY-MM-DD), heure (format HH:MM), nombre de litres, prix unitaire au litre en euros, montant total payé en euros, nom de la station/enseigne, type de carburant (gazole, SP95, SP98, E10, AdBlue, etc.).`;

const imageMediaTypeFromFilename = (filename: string): string => {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
};

export async function extractFuelReceipt(imageBytes: Buffer, filename: string): Promise<FuelReceiptOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const toolSchema = {
    type: "object" as const,
    properties: {
      date: { anyOf: [{ type: "string" }, { type: "null" }] },
      time: { anyOf: [{ type: "string" }, { type: "null" }] },
      liters: { anyOf: [{ type: "number" }, { type: "null" }] },
      unit_price: { anyOf: [{ type: "number" }, { type: "null" }] },
      total_amount: { anyOf: [{ type: "number" }, { type: "null" }] },
      station_name: { anyOf: [{ type: "string" }, { type: "null" }] },
      fuel_type: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["date", "time", "liters", "unit_price", "total_amount", "station_name", "fuel_type"],
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
              { type: "text", text: "Extrais les champs de ce ticket de carburant via l'outil fourni." },
            ],
          },
        ],
        tools: [{ name: "fuel_receipt", description: "Champs extraits du ticket de carburant.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "fuel_receipt" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "fuel_receipt");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = fuelReceiptSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, fields: parsed.data, raw: data };
}
