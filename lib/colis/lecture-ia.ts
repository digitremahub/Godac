import "server-only";

/**
 * Lit l'adresse du destinataire sur la photo d'une étiquette de colis
 * (Claude vision), comme la lecture d'étiquette des applications de
 * tournée. La photo n'est ni stockée ni journalisée : elle est envoyée,
 * lue, puis oubliée — seuls l'adresse et le numéro de colis reviennent.
 */
export interface EtiquetteLue {
  adresse: string | null;
  destinataire: string | null;
  code: string | null;
}

export type LectureResult = { ok: true; etiquette: EtiquetteLue } | { ok: false; reason: string };

const PROMPT = `Tu lis la photo d'une étiquette de colis (DPD, Colissimo, Chronopost, GLS, UPS, DHL…). Extrais UNIQUEMENT l'adresse de LIVRAISON du destinataire (pas l'expéditeur, pas le dépôt) : numéro et rue, complément utile (bâtiment, lieu-dit), code postal et ville, sur une seule ligne. Donne aussi le nom du destinataire (personne ou société) et le numéro de colis / de suivi s'ils sont lisibles. Ne devine jamais : null si illisible.`;

export async function lireEtiquette(imageBase64: string, mediaType: string): Promise<LectureResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  const schema = {
    type: "object" as const,
    properties: {
      adresse: { anyOf: [{ type: "string" }, { type: "null" }] },
      destinataire: { anyOf: [{ type: "string" }, { type: "null" }] },
      code: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    required: ["adresse", "destinataire", "code"],
  };
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 512,
        system: PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: "Extrais l'adresse de livraison via l'outil fourni." },
            ],
          },
        ],
        tools: [{ name: "etiquette", description: "Adresse de livraison lue sur l'étiquette.", input_schema: schema }],
        tool_choice: { type: "tool", name: "etiquette" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error" };
  }
  if (!response.ok) return { ok: false, reason: `Anthropic API error ${response.status}` };
  const data = (await response.json()) as { content?: { type: string; input?: Partial<EtiquetteLue> }[] };
  const input = data.content?.find((c) => c.type === "tool_use")?.input;
  if (!input) return { ok: false, reason: "réponse IA inattendue" };
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  return { ok: true, etiquette: { adresse: clean(input.adresse), destinataire: clean(input.destinataire), code: clean(input.code) } };
}
