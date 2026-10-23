import "server-only";
import { extraireTelephone, normaliserTelephone } from "@/lib/colis/telephone";
import { lirePoids } from "@/lib/colis/poids";
import { colonnesCreneau, erreurCreneau, type CreneauSaisi } from "@/lib/colis/creneau";

/**
 * Lit l'adresse du destinataire sur la photo d'une étiquette de colis
 * (Claude vision), comme la lecture d'étiquette des applications de
 * tournée. La photo n'est ni stockée ni journalisée : elle est envoyée,
 * lue, puis oubliée — seuls l'adresse, le téléphone, le poids et le numéro de colis reviennent.
 */
export interface EtiquetteLue {
  adresse: string | null;
  destinataire: string | null;
  code: string | null;
  telephone: string | null;
  /** Poids du colis en kg (les grammes sont convertis). */
  poids: number | null;
  /** Créneau imprimé sur l'étiquette (Predict DPD « 10:00-13:00 », « avant 10:00 »), absent sinon. */
  creneau?: CreneauSaisi;
}

/** `occupe` : service IA surchargé ou lent (réessayer) ; `illisible` : réponse sans champs exploitables ; `indisponible` : clé absente / erreur de configuration. */
export type LectureResult = { ok: true; etiquette: EtiquetteLue } | { ok: false; reason: string; type?: "occupe" | "illisible" | "indisponible" };

const DELAI_APPEL_MS = 20_000;
const STATUTS_REESSAYABLES = new Set([408, 429, 500, 502, 503, 504, 529]);

const PROMPT = `Lis cette étiquette de colis. Priorité absolue : adresse de LIVRAISON du destinataire (numéro, rue, complément utile, code postal, ville), jamais l’expéditeur ni le dépôt. Extrais aussi le nom du destinataire, son téléphone, le poids en kg (convertis les grammes), le numéro de suivi et le créneau de livraison imprimé (ex. Predict 10:00-13:00, « avant 10:00 ») s’ils sont lisibles. Ne devine rien : renvoie null si illisible. Réponse très concise.`;

/**
 * Champs bruts renvoyés par l'IA → étiquette nettoyée : téléphone normalisé
 * selon le pays de l'entreprise (repris dans l'adresse s'il y figure),
 * poids en kg. Pure, testée (lib/colis/__tests__/lecture-ia.test.ts).
 */
export function nettoyerEtiquette(input: Record<string, unknown>, pays = "FR"): EtiquetteLue {
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const telephone = normaliserTelephone(clean(input.telephone), pays) ?? extraireTelephone(clean(input.telephone), pays);
  // Créneau : gardé seulement s'il est lisible et cohérent (fin après début).
  const creneau = { debut: clean(input.creneau_debut), fin: clean(input.creneau_fin) };
  const creneauLu = (creneau.debut || creneau.fin) && !erreurCreneau(creneau) ? colonnesCreneau(creneau) : null;
  return {
    adresse: clean(input.adresse),
    destinataire: clean(input.destinataire),
    code: clean(input.code),
    telephone,
    poids: lirePoids(input.poids),
    ...(creneauLu ? { creneau: { debut: creneauLu.window_start, fin: creneauLu.window_end } } : {}),
  };
}

export async function lireEtiquette(imageBase64: string, mediaType: string, pays = "FR"): Promise<LectureResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: "ANTHROPIC_API_KEY is not configured", type: "indisponible" };
  const schema = {
    type: "object" as const,
    properties: {
      adresse: { anyOf: [{ type: "string" }, { type: "null" }] },
      destinataire: { anyOf: [{ type: "string" }, { type: "null" }] },
      code: { anyOf: [{ type: "string" }, { type: "null" }] },
      telephone: { anyOf: [{ type: "string" }, { type: "null" }] },
      poids: { anyOf: [{ type: "number" }, { type: "null" }], description: "Poids du colis en kg (850 g → 0.85)" },
      creneau_debut: { anyOf: [{ type: "string" }, { type: "null" }], description: "Début du créneau de livraison imprimé, HH:MM (null si « avant … » ou absent)" },
      creneau_fin: { anyOf: [{ type: "string" }, { type: "null" }], description: "Fin du créneau de livraison imprimé, HH:MM (null si absent)" },
    },
    required: ["adresse", "destinataire", "code", "telephone", "poids"],
  };
  const corps = JSON.stringify({
    model: "claude-haiku-4-5",
    // Pas de « thinking » : lecture directe, la réponse tient en ~150 jetons.
    max_tokens: 400,
    system: PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Lis les champs demandés rapidement et sans rien inventer." },
        ],
      },
    ],
    tools: [{ name: "etiquette", description: "Adresse de livraison lue sur l'étiquette.", input_schema: schema }],
    tool_choice: { type: "tool", name: "etiquette" },
  });
  // Un appel borné à 20 s, répété une fois si le service est surchargé ou injoignable (429/5xx/529, coupure).
  let response: Response | null = null;
  let raison = "network error";
  for (let essai = 0; essai < 2 && !response; essai++) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: corps,
        signal: AbortSignal.timeout(DELAI_APPEL_MS),
      });
      if (r.ok) response = r;
      else {
        raison = `Anthropic API error ${r.status}`;
        if (!STATUTS_REESSAYABLES.has(r.status)) return { ok: false, reason: raison, type: r.status === 401 || r.status === 403 ? "indisponible" : "illisible" };
        await new Promise((ok) => setTimeout(ok, 600));
      }
    } catch (e) {
      raison = e instanceof Error ? e.message : "network error";
    }
  }
  if (!response) return { ok: false, reason: raison, type: "occupe" };
  const data = (await response.json()) as { content?: { type: string; input?: Record<string, unknown> }[] };
  const input = data.content?.find((c) => c.type === "tool_use")?.input;
  if (!input) return { ok: false, reason: "réponse IA inattendue", type: "illisible" };
  return { ok: true, etiquette: nettoyerEtiquette(input, pays) };
}
