import "server-only";

/**
 * Last-resort import path: hands the raw file content to Claude when
 * the deterministic header-row parser (lib/import/parse-table.ts) came
 * back with nothing usable — a pivoted/multi-block layout, several
 * mini-tables side by side, column names it doesn't recognize, a
 * different language, etc. Rather than growing lib/utils/csv.ts's
 * HEADER_ALIASES map forever for every new client's spreadsheet shape,
 * the model reads the structure itself, the same way a human would.
 *
 * Plain fetch to the Messages API, matching lib/ocr/tour-report.ts's
 * style (no SDK dependency) — never throws for a business-level failure
 * (missing key, malformed response): callers get `{ ok: false, reason }`
 * and fall back to showing the normal "no rows found" validation UI.
 */

export type AiExtractResult =
  | { ok: true; rows: Record<string, string>[] }
  | { ok: false; reason: string };

interface FieldGuide {
  description: string;
  fields: { name: string; desc: string }[];
}

const FIELD_GUIDES: Record<"vehicles" | "drivers", FieldGuide> = {
  vehicles: {
    description: "une flotte de véhicules d'une entreprise de transport routier français",
    fields: [
      { name: "registration", desc: "immatriculation du véhicule — obligatoire" },
      {
        name: "type",
        desc:
          "un de: VL (véhicule léger, en général < 3,5T), PL (poids lourd, camion rigide, ~12-19T) ou SPL " +
          "(semi-remorque / tracteur articulé) — déduis-le du tonnage ou de la catégorie indiquée",
      },
      { name: "service", desc: "dépôt, agence, ou loueur/bailleur du véhicule s'il est visible (optionnel)" },
      { name: "tank_capacity_liters", desc: "capacité du réservoir en litres, si indiquée (optionnel)" },
      { name: "initial_km", desc: "kilométrage actuel du véhicule, si indiqué (optionnel)" },
    ],
  },
  drivers: {
    description: "les collaborateurs/chauffeurs d'une entreprise de transport routier français",
    fields: [
      { name: "full_name", desc: "nom complet — combine prénom + nom si ce sont deux colonnes séparées — obligatoire" },
      { name: "email", desc: "adresse email — obligatoire, n'invente jamais une adresse, ignore la ligne si absente" },
      {
        name: "role",
        desc: "un de: chauffeur, manager, comptable, direction — \"chauffeur\" par défaut si rien d'autre n'est indiqué",
      },
      { name: "phone", desc: "numéro de téléphone, si indiqué (optionnel)" },
      { name: "service", desc: "service/dépôt/agence, si indiqué (optionnel)" },
    ],
  },
};

const MAX_INPUT_CHARS = 100_000;

export async function extractRowsWithAI(
  rawText: string,
  kind: "vehicles" | "drivers",
): Promise<AiExtractResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  }

  const guide = FIELD_GUIDES[kind];
  const fieldList = guide.fields.map((f) => `- ${f.name}: ${f.desc}`).join("\n");
  const truncated = rawText.length > MAX_INPUT_CHARS;

  const prompt = `Voici le contenu brut d'un fichier (CSV ou export Excel — toutes les feuilles, toutes les lignes et colonnes, tel quel) envoyé par un client pour importer ${guide.description} dans un logiciel SaaS.

La mise en page peut être n'importe quoi : un tableau normal avec en-têtes, plusieurs mini-tableaux placés côte à côte (groupes de colonnes répétés), des en-têtes fusionnés/répétés sur plusieurs lignes, une feuille d'instructions à ignorer, des lignes de total ou de formule isolées à ignorer, des colonnes dans une langue ou un ordre inattendu, etc. Analyse la structure toi-même — ne suppose jamais que la ligne 1 est l'en-tête ni qu'il n'y a qu'un seul tableau — et extrait chaque enregistrement valide que tu identifies.

Champs à extraire pour chaque enregistrement :
${fieldList}

Ignore toute ligne qui n'est manifestement pas un enregistrement valide.

Contenu du fichier${truncated ? " (tronqué)" : ""} :
"""
${rawText.slice(0, MAX_INPUT_CHARS)}
"""`;

  const fieldSchema = Object.fromEntries(guide.fields.map((f) => [f.name, { type: "string" }]));

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
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
        tools: [
          {
            name: "extracted_rows",
            description: "Les enregistrements extraits du fichier, un par véhicule/chauffeur identifié.",
            input_schema: {
              type: "object",
              properties: {
                rows: { type: "array", items: { type: "object", properties: fieldSchema } },
              },
              required: ["rows"],
            },
          },
        ],
        tool_choice: { type: "tool", name: "extracted_rows" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error calling Anthropic API" };
  }

  if (!response.ok) {
    return { ok: false, reason: `Anthropic API error ${response.status}: ${await response.text()}` };
  }

  const data = (await response.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const toolUse = data.content?.find((c) => c.type === "tool_use" && c.name === "extracted_rows");
  const rows = (toolUse?.input as { rows?: unknown } | undefined)?.rows;
  if (!Array.isArray(rows)) {
    return { ok: false, reason: "AI response did not contain the expected structured rows" };
  }

  return {
    ok: true,
    rows: rows.filter((r): r is Record<string, string> => typeof r === "object" && r !== null),
  };
}
