import "server-only";
import { z } from "zod";

/**
 * Lot C: reads a tour report photo — either the handheld terminal's
 * "Statistiques Tournée" screen (photographed at departure) or the
 * printed "Compte-rendu de Tournée" (photographed at return, e.g. a
 * DPD-style dot-matrix report) — and extracts the numbers a driver
 * would otherwise retype by hand. Neither is a document Mindee has a
 * model for (it's an arbitrary handheld UI or a company-specific
 * printout, not a standardised receipt), so this goes straight to
 * Claude's vision instead, same client/model/never-throw style as
 * lib/import/ai-extract.ts and lib/vehicles/ai-specs.ts.
 */

const fieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) => valueSchema.nullable();

export const tourReportSchema = z.object({
  tour_number: fieldSchema(z.string()),
  bl_number: fieldSchema(z.string()),
  stops_total: fieldSchema(z.number().int().nonnegative()),
  packages_count: fieldSchema(z.number().int().nonnegative()),
  priority_count: fieldSchema(z.number().int().nonnegative()),
  stops_delivered: fieldSchema(z.number().int().nonnegative()),
  packages_missing: fieldSchema(z.number().int().nonnegative()),
  pickups: fieldSchema(z.number().int().nonnegative()),
  // Printed on the bordereau itself — distinct from start_at/end_at,
  // which are stamped by the app at the moment of the QR scan.
  departure_time: fieldSchema(z.string()),
  return_time: fieldSchema(z.string()),
  // Package-level counts beyond "pickups" (which is a STOP count —
  // "Stop(s) ramasse"): how many packages were actually collected,
  // brought back undelivered, or dropped at a relay point.
  packages_picked_up: fieldSchema(z.number().int().nonnegative()),
  packages_returned: fieldSchema(z.number().int().nonnegative()),
  packages_relay: fieldSchema(z.number().int().nonnegative()),
});

export type TourReportFields = z.infer<typeof tourReportSchema>;

export type TourReportOcrResult =
  | { ok: true; fields: TourReportFields; raw: unknown }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `Tu lis une photo d'un rapport de tournée de livraison (écran de terminal portable type Honeywell, ou compte-rendu imprimé type DPD/transporteur). Extrais uniquement les chiffres et références explicitement lisibles sur la photo — ne devine jamais une valeur absente ou floue, renvoie null dans ce cas. Les champs correspondent typiquement à : numéro de tournée ("Num Tour", "Tournée"), numéro de bordereau/BL ("Num BL", "Bordereau"), nombre total d'arrêts/stops, nombre de colis, nombre de colis prioritaires ("Prio"), nombre d'arrêts livrés ("Livré"), nombre de colis non livrés/manquants, nombre de stops de ramasse ("Stop(s) ramasse"), heure de départ, heure de retour, nombre de colis ramassés (collectés chez un client, distinct du nombre de stops de ramasse), nombre de colis ramenés au dépôt (non livrés, rapportés physiquement), nombre de colis déposés en point relais. Un rapport ne contient pas forcément tous ces champs — renvoie null pour ceux qui sont absents.`;

const imageMediaTypeFromFilename = (filename: string): string => {
  if (filename.endsWith(".png")) return "image/png";
  if (filename.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
};

export async function extractTourReportFromImage(imageBytes: Buffer, filename: string): Promise<TourReportOcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const toolSchema = {
    type: "object" as const,
    properties: {
      tour_number: { anyOf: [{ type: "string" }, { type: "null" }] },
      bl_number: { anyOf: [{ type: "string" }, { type: "null" }] },
      stops_total: { anyOf: [{ type: "integer" }, { type: "null" }] },
      packages_count: { anyOf: [{ type: "integer" }, { type: "null" }] },
      priority_count: { anyOf: [{ type: "integer" }, { type: "null" }] },
      stops_delivered: { anyOf: [{ type: "integer" }, { type: "null" }] },
      packages_missing: { anyOf: [{ type: "integer" }, { type: "null" }] },
      pickups: { anyOf: [{ type: "integer" }, { type: "null" }] },
      departure_time: { anyOf: [{ type: "string" }, { type: "null" }] },
      return_time: { anyOf: [{ type: "string" }, { type: "null" }] },
      packages_picked_up: { anyOf: [{ type: "integer" }, { type: "null" }] },
      packages_returned: { anyOf: [{ type: "integer" }, { type: "null" }] },
      packages_relay: { anyOf: [{ type: "integer" }, { type: "null" }] },
    },
    required: [
      "tour_number",
      "bl_number",
      "stops_total",
      "packages_count",
      "priority_count",
      "stops_delivered",
      "packages_missing",
      "pickups",
      "departure_time",
      "return_time",
      "packages_picked_up",
      "packages_returned",
      "packages_relay",
    ],
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
              { type: "text", text: "Extrais les champs du rapport de tournée visible sur cette photo via l'outil fourni." },
            ],
          },
        ],
        tools: [{ name: "tour_report", description: "Champs extraits du rapport de tournée.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "tour_report" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "tour_report");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = tourReportSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, fields: parsed.data, raw: data };
}
