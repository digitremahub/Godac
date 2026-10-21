import "server-only";
import { pageLueSchema, type PageLue } from "@/lib/colis/bordereau";

/**
 * Lit une page photographiée du « BORDEREAU DE TOURNEE » DPD remis au
 * départ : en-tête (n° de bordereau, tournée, date, page, totaux, texte du
 * code-barres) et blocs numérotés (destinataire, adresse, téléphone,
 * colis, poids, codes CR / PRE / RDV, horaires d'enlèvement…). Même
 * client que lib/ocr/tour-report.ts (Claude vision, sortie structurée par
 * un outil imposé, jamais d'exception) ; la normalisation est faite
 * ensuite par lib/colis/bordereau.ts. La photo n'est ni stockée ni
 * journalisée.
 */

export const MODELE_BORDEREAU = "claude-sonnet-5";

/** Délai de lecture d'une page (au-delà : « réessayez »). */
export const DELAI_LECTURE_MS = 90_000;

export type LectureBordereau = { ok: true; page: PageLue } | { ok: false; raison: "illisible" | "delai" | "ia"; detail: string };

const SYSTEM_PROMPT = `Tu lis la photo d'une page d'un « BORDEREAU DE TOURNEE » DPD (liste imprimée des colis d'une tournée de livraison). Recopie fidèlement ce qui est imprimé, sans rien inventer, compléter ni corriger : un champ absent, coupé ou illisible vaut null (ou une liste vide). N'invente jamais un chiffre de code postal, de téléphone ou de numéro de colis.

Si la photo est trop floue, coupée, trop de travers pour être lue, ou si ce n'est pas un bordereau de tournée : lisible = false et blocs = [].

En-tête :
- numero : le n° de bordereau tel qu'imprimé après « N° : » (ex. « 123,456 »).
- tournee : le n° après « Tournée : ».
- date : la date après « Date : » telle qu'imprimée.
- page : le n° après « Page : ».
- total_colis / total_poids_kg : les totaux de l'en-tête (« / 131 Colis / 986.03 kg »).
- code_barres : les chiffres imprimés SOUS le code-barres principal (ne décode pas les barres).

Blocs : un bloc par position (« Pos » 1, 2, 3…), séparés par des traits, dans l'ordre de la page. Un bloc peut tenir sur une seule ligne (« NOM, RUE, F-CP VILLE, tél… »). Un bloc coupé en bas ou en haut de page est lu pour la partie visible.
- position : le numéro de position à gauche.
- codes : les codes imprimés à gauche sous la position (« CR », « PRE », « PRE /RDV », « REL »…), un par ligne, tels quels.
- nom : le destinataire (en gras), sans le contact entre parenthèses ; contact : ce qui est entre parenthèses après le nom.
- adresse : numéro et rue seulement ; localite : code pays, code postal et ville exactement comme imprimés (ex. « F-66000 PERPIGNAN », y compris « .. » si la ville est coupée).
- telephone : tel qu'imprimé (« 04.68.00.00.00 », « +336… », « 0.. » s'il est coupé).
- expediteur : la ligne expéditeur / donneur d'ordre sous le destinataire (ex. « SOCIETE X, B-9100 VILLE (DPD 121) »).
- colis : chaque n° de colis (14 chiffres, sans la lettre qui suit) avec son poids en kg sur la même ligne.
- nombre_colis / poids_total_kg : la ligne « N Colis en bon état » et son poids.
- nature : « Divers », « Pneus »… ; mentions : « Emargement obligatoire… », « Nom, tampons, signature » n'est PAS une mention.
- horaires : la PREMIÈRE ligne « Enl.: … » (enlèvement), ou un créneau / horaires imprimés, recopiée telle quelle avec les « ~ ».
- adresse_rappel : l'adresse entre crochets « [ … ] » sans les crochets.
Ignore « Pour toute information sur vos données personnelles… » et les lignes « Nom, tampons, signature ».`;

const n = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA = {
  type: "object" as const,
  properties: {
    lisible: { type: "boolean" },
    entete: {
      type: "object",
      properties: {
        numero: n("string"),
        tournee: n("string"),
        date: n("string"),
        page: n("integer"),
        total_colis: n("integer"),
        total_poids_kg: n("number"),
        code_barres: n("string"),
      },
      required: ["numero", "tournee", "date", "page", "total_colis", "total_poids_kg", "code_barres"],
    },
    blocs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          position: n("integer"),
          codes: { type: "array", items: { type: "string" } },
          nom: n("string"),
          contact: n("string"),
          adresse: n("string"),
          localite: n("string"),
          telephone: n("string"),
          expediteur: n("string"),
          colis: {
            type: "array",
            items: { type: "object", properties: { numero: n("string"), poids_kg: n("number") }, required: ["numero", "poids_kg"] },
          },
          nombre_colis: n("integer"),
          poids_total_kg: n("number"),
          nature: n("string"),
          horaires: n("string"),
          mentions: n("string"),
          adresse_rappel: n("string"),
        },
        required: ["position", "codes", "nom", "contact", "adresse", "localite", "telephone", "expediteur", "colis", "nombre_colis", "poids_total_kg", "nature", "horaires", "mentions", "adresse_rappel"],
      },
    },
  },
  required: ["lisible", "entete", "blocs"],
};

export async function lireBordereau(imageBase64: string, mediaType: string): Promise<LectureBordereau> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, raison: "ia", detail: "ANTHROPIC_API_KEY is not configured" };
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(DELAI_LECTURE_MS),
      body: JSON.stringify({
        model: MODELE_BORDEREAU,
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
              { type: "text", text: "Lis cette page du bordereau de tournée via l'outil fourni, sans rien inventer." },
            ],
          },
        ],
        tools: [{ name: "bordereau", description: "En-tête et blocs lus sur la page du bordereau de tournée.", input_schema: SCHEMA }],
        tool_choice: { type: "tool", name: "bordereau" },
      }),
    });
  } catch (e) {
    const delai = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, raison: delai ? "delai" : "ia", detail: e instanceof Error ? e.message : "network error" };
  }
  if (!response.ok) return { ok: false, raison: "ia", detail: `Anthropic API error ${response.status}` };
  const data = (await response.json().catch(() => null)) as { stop_reason?: string; content?: { type: string; name?: string; input?: unknown }[] } | null;
  const input = data?.content?.find((c) => c.type === "tool_use" && c.name === "bordereau")?.input;
  if (!input) return { ok: false, raison: "ia", detail: "réponse IA inattendue" };
  const parsed = pageLueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, raison: data?.stop_reason === "max_tokens" ? "ia" : "illisible", detail: parsed.error.message.slice(0, 300) };
  if (!parsed.data.lisible || (!parsed.data.blocs.length && !parsed.data.entete.numero)) return { ok: false, raison: "illisible", detail: "page illisible" };
  return { ok: true, page: parsed.data };
}
