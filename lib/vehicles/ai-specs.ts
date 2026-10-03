import "server-only";
import { z } from "zod";

/**
 * Lot A: AI-assisted completion of a vehicle fiche. Same Anthropic
 * client/model/validation style as lib/import/ai-extract.ts (plain
 * fetch to the Messages API, structured output via tool_choice,
 * never throws for a business-level failure). The registration plate
 * is never sent — it carries no signal about tank capacity, PTAC,
 * etc., only brand/model/year/gearbox do.
 */

const CONFIDENCE = z.enum(["élevé", "moyen", "faible"]);

const fieldSchema = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({ value: valueSchema.nullable(), confidence: CONFIDENCE.nullable() });

export const aiVehicleSpecsSchema = z.object({
  type: fieldSchema(z.enum(["VL", "PL", "SPL"])),
  fuel_type: fieldSchema(z.string()),
  tank_capacity_liters: fieldSchema(z.number().positive()),
  adblue_capacity_liters: fieldSchema(z.number().positive()),
  ptac_kg: fieldSchema(z.number().positive()),
  reference_consumption_l_100km: fieldSchema(z.number().positive()),
  /**
   * Set when brand/model/year/gearbox match several distinct
   * versions with materially different specs (e.g. several tank
   * sizes) — the form then asks the user to pick one instead of
   * silently averaging or guessing.
   */
  variants: z
    .array(
      z.object({
        label: z.string(),
        tank_capacity_liters: z.number().positive().nullable(),
        ptac_kg: z.number().positive().nullable(),
      }),
    )
    .default([]),
});

export type AiVehicleSpecs = z.infer<typeof aiVehicleSpecsSchema>;

export type AiVehicleSpecsResult =
  | { ok: true; specs: AiVehicleSpecs }
  | { ok: false; reason: string };

const SYSTEM_PROMPT = `Tu aides à compléter la fiche technique d'un véhicule professionnel (VL/PL/SPL) pour une entreprise française de transport routier.

Règles strictes :
- Base-toi uniquement sur ta connaissance des caractéristiques constructeur réelles de ce modèle.
- Si tu ne connais pas une valeur avec une confiance raisonnable, renvoie null pour cette valeur plutôt que d'inventer un chiffre plausible.
- N'arrondis pas de façon trompeuse : donne la valeur la plus représentative du modèle décrit.
- Si le modèle correspond à plusieurs versions distinctes avec des caractéristiques notablement différentes (plusieurs tailles de réservoir par exemple), renvoie ces versions dans "variants" plutôt que de deviner laquelle.
- N'invente jamais de numéro, de référence ou de donnée réglementaire.`;

export async function fetchVehicleAiSpecs(input: {
  brand: string;
  model: string;
  year?: number;
  gearbox?: string;
}): Promise<AiVehicleSpecsResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const prompt = `Véhicule à documenter :
- Marque : ${input.brand}
- Modèle : ${input.model}
${input.year ? `- Année : ${input.year}\n` : ""}${input.gearbox ? `- Boîte de vitesses : ${input.gearbox}\n` : ""}
Renvoie ses caractéristiques via l'outil fourni.`;

  const toolSchema = {
    type: "object" as const,
    properties: {
      type: fieldToolSchema({ type: "string", enum: ["VL", "PL", "SPL"] }),
      fuel_type: fieldToolSchema({ type: "string" }),
      tank_capacity_liters: fieldToolSchema({ type: "number" }),
      adblue_capacity_liters: fieldToolSchema({ type: "number" }),
      ptac_kg: fieldToolSchema({ type: "number" }),
      reference_consumption_l_100km: fieldToolSchema({ type: "number" }),
      variants: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            tank_capacity_liters: { type: ["number", "null"] },
            ptac_kg: { type: ["number", "null"] },
          },
          required: ["label"],
        },
      },
    },
    required: ["type", "fuel_type", "tank_capacity_liters", "adblue_capacity_liters", "ptac_kg", "reference_consumption_l_100km"],
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
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        tools: [{ name: "vehicle_specs", description: "Caractéristiques techniques estimées du véhicule.", input_schema: toolSchema }],
        tool_choice: { type: "tool", name: "vehicle_specs" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "vehicle_specs");
  if (!toolUse) {
    return { ok: false, reason: "AI response did not contain the expected structured output" };
  }

  const parsed = aiVehicleSpecsSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    return { ok: false, reason: `malformed AI response: ${parsed.error.message}` };
  }

  return { ok: true, specs: parsed.data };
}

function fieldToolSchema(valueSchema: Record<string, unknown>) {
  return {
    type: "object",
    properties: {
      value: { anyOf: [valueSchema, { type: "null" }] },
      confidence: { anyOf: [{ type: "string", enum: ["élevé", "moyen", "faible"] }, { type: "null" }] },
    },
    required: ["value", "confidence"],
  };
}

/** `spec_sources` cell shape stored per field on `vehicles.spec_sources`. */
export interface SpecSourceEntry {
  origin: "ia" | "saisie" | "import";
  confirmed: boolean;
}

export type SpecSources = Record<string, SpecSourceEntry>;

/** Vehicle fields `spec_sources` can describe — kept in one place so the UI and the TICPE guard rail agree on the key names. */
export const AI_SPEC_FIELDS = [
  "type",
  "fuel_type",
  "tank_capacity_liters",
  "adblue_capacity_liters",
  "ptac_kg",
  "reference_consumption_l_100km",
] as const;

export type AiSpecField = (typeof AI_SPEC_FIELDS)[number];
