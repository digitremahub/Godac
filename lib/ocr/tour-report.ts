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

/**
 * Le document imprime un total de stops qui inclut les ramasses ; GODAC
 * compte les arrêts de LIVRAISON : stops_total = stops du scan − stops de
 * ramasse. Fait ici (et non par l'IA) pour que le calcul soit fiable.
 * Accepte aussi une réponse déjà au format final (stops_total).
 */
export function normaliserLecture(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const { stops_scan, ...reste } = input as Record<string, unknown>;
  if (stops_scan === undefined) return input;
  const ramasses = typeof reste.pickups === "number" ? reste.pickups : 0;
  const stops_total = typeof stops_scan === "number" ? Math.max(0, stops_scan - ramasses) : null;
  return { ...reste, stops_total };
}

export type TourReportOcrResult =
  | { ok: true; fields: TourReportFields; raw: unknown }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `Tu lis une photo ou un scan d'un rapport de tournée de livraison (écran de terminal portable type Honeywell « Statistiques Tournée », ou compte-rendu de tournée imprimé type DPD/transporteur). Recopie uniquement les chiffres et références explicitement lisibles — ne devine jamais une valeur absente ou floue, ne fais aucun calcul : renvoie null pour ce qui n'est pas lisible.

Règles de lecture (importantes) :
- stops_scan : le nombre de stops / arrêts TOTAL tel qu'il est imprimé sur le document (« Stops », « Nb stops », « Arrêts »). Ce total INCLUT les stops de ramasse : recopie-le tel quel, la déduction des ramasses est faite ensuite par le logiciel.
- pickups : le nombre de STOPS de ramasse (« Stop(s) ramasse », « Ramasse », « Enlèvement »), pas le nombre de colis ramassés.
- stops_delivered : le nombre de colis REMIS (ligne « Remis », « Colis remis », « Remis destinataire »). Chez le transporteur, chaque colis remis correspond à un stop livré : c'est CE chiffre qu'il faut renvoyer comme stops livrés. N'utilise pas une autre ligne « Livré » si une ligne « Remis » existe.
- packages_count : le nombre total de colis chargés / en charge (« Colis », « Nb colis »).
- priority_count : colis prioritaires (« Prio », « Predict », « Express »).
- packages_missing : colis manquants (« Manquant », « Non trouvés », « Absents au chargement »).
- packages_returned : colis non remis et rapportés au dépôt (« Retour », « Non remis », « Rapportés »).
- packages_relay : colis déposés en point relais (« Relais », « Pickup », « Point relais »).
- packages_picked_up : nombre de COLIS collectés lors des ramasses (distinct du nombre de stops de ramasse).
- tour_number : numéro de tournée (« Num Tour », « Tournée ») ; bl_number : numéro de bordereau / BL (« Num BL », « Bordereau »).
- departure_time / return_time : heures de départ et de retour imprimées (format HH:MM).
Un rapport ne contient pas forcément tous ces champs — renvoie null pour ceux qui sont absents.`;

/**
 * Builds the right Claude content block for whatever got uploaded —
 * a PDF scan (téléversé depuis un PC) needs a "document" block, not
 * an "image" one, which Claude would otherwise reject. Everything
 * else (photo from the camera or an existing image file) stays an
 * image block, as before.
 */
function contentBlockFromFile(imageBytes: Buffer, filename: string) {
  const data = imageBytes.toString("base64");
  if (filename.toLowerCase().endsWith(".pdf")) {
    return { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf", data } };
  }
  const media_type = filename.endsWith(".png") ? "image/png" : filename.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { type: "image" as const, source: { type: "base64" as const, media_type, data } };
}

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
      stops_scan: { anyOf: [{ type: "integer" }, { type: "null" }] },
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
      "stops_scan",
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
              contentBlockFromFile(imageBytes, filename),
              { type: "text", text: "Extrais les champs du rapport de tournée visible sur ce document via l'outil fourni." },
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

  const parsed = tourReportSchema.safeParse(normaliserLecture(toolUse.input));
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, fields: parsed.data, raw: data };
}
