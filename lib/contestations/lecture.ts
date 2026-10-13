import "server-only";

/**
 * Lecture d'une réclamation client (courrier, e-mail imprimé, capture
 * d'écran du portail transporteur, PDF) par Claude. Ne fait que
 * préremplir le formulaire : un humain relit et valide chaque champ.
 */
export interface ContestationLue {
  client_name: string | null;
  reference: string | null;
  parcel_code: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  tour_number: string | null;
  reason: string | null;
  claimed_amount: number | null;
}

const PROMPT = `Tu lis une réclamation ou contestation client adressée à une entreprise de transport / livraison (colis non reçu, livré au mauvais endroit, endommagé, retard, comportement du livreur, litige de signature…). Extrais uniquement ce qui est explicitement écrit, sans rien deviner (null sinon) :
- client_name : nom du client ou de la société qui réclame ;
- reference : numéro de réclamation / dossier / ticket ;
- parcel_code : numéro de colis ou de suivi ;
- delivery_address : adresse de livraison concernée, sur une ligne ;
- delivery_date : date de la livraison ou de la tentative (AAAA-MM-JJ) ;
- tour_number : numéro de tournée s'il apparaît ;
- reason : motif de la contestation résumé en une phrase claire ;
- claimed_amount : montant réclamé en euros (nombre).`;

export type LectureContestation = { ok: true; champs: ContestationLue } | { ok: false; reason: string };

export async function lireContestation(bytes: Buffer, mediaType: string): Promise<LectureContestation> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not configured" };
  const nullable = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });
  const schema = {
    type: "object" as const,
    properties: {
      client_name: nullable("string"),
      reference: nullable("string"),
      parcel_code: nullable("string"),
      delivery_address: nullable("string"),
      delivery_date: nullable("string"),
      tour_number: nullable("string"),
      reason: nullable("string"),
      claimed_amount: nullable("number"),
    },
    required: ["client_name", "reference", "parcel_code", "delivery_address", "delivery_date", "tour_number", "reason", "claimed_amount"],
  };
  const source = { type: "base64", media_type: mediaType, data: bytes.toString("base64") };
  const piece = mediaType === "application/pdf" ? { type: "document", source } : { type: "image", source };
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system: PROMPT,
        messages: [{ role: "user", content: [piece, { type: "text", text: "Extrais les champs de cette contestation via l'outil fourni." }] }],
        tools: [{ name: "contestation", description: "Champs lus sur la contestation.", input_schema: schema }],
        tool_choice: { type: "tool", name: "contestation" },
      }),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "network error" };
  }
  if (!response.ok) return { ok: false, reason: `Anthropic API error ${response.status}` };
  const data = (await response.json()) as { content?: { type: string; input?: Record<string, unknown> }[] };
  const input = data.content?.find((c) => c.type === "tool_use")?.input;
  if (!input) return { ok: false, reason: "réponse IA inattendue" };
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 500) : null);
  const date = str(input.delivery_date);
  return {
    ok: true,
    champs: {
      client_name: str(input.client_name),
      reference: str(input.reference),
      parcel_code: str(input.parcel_code),
      delivery_address: str(input.delivery_address),
      delivery_date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      tour_number: str(input.tour_number),
      reason: str(input.reason),
      claimed_amount: typeof input.claimed_amount === "number" && input.claimed_amount >= 0 ? input.claimed_amount : null,
    },
  };
}
