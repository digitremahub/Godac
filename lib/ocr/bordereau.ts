import "server-only";
import { pageLueSchema, type PageLue } from "@/lib/colis/bordereau";

/**
 * Lit une page photographiée d'un bordereau de tournée (feuille de route,
 * bordereau de départ, liste de chargement) de n'importe quel transporteur
 * de messagerie : en-tête (transporteur, n° de bordereau, tournée, date,
 * page, totaux, texte du code-barres) et un bloc par arrêt ou par colis
 * (destinataire, adresse, téléphone, colis, poids, codes de service,
 * horaires d'enlèvement…). Même client que lib/ocr/tour-report.ts (Claude
 * vision, sortie structurée par un outil imposé, jamais d'exception) ; la
 * normalisation est faite ensuite par lib/colis/bordereau.ts. La photo
 * n'est ni stockée ni journalisée.
 */

export const MODELE_BORDEREAU = "claude-sonnet-5";

/**
 * Temps total accordé à la lecture d'une page, nouvel essai compris : sous
 * le maxDuration (300 s) de la route, pour répondre un message clair
 * plutôt que d'être coupé par l'hébergeur.
 */
export const DELAI_LECTURE_MS = 270_000;

/**
 * Plafond de sortie. Une page DPD dense (15 blocs, chacun avec plusieurs
 * colis et lignes d'enlèvement) dépassait les 8192 jetons d'avant : la
 * réponse était coupée, l'outil rendu incomplet, et chaque photo finissait
 * en « Lecture indisponible ». Au-delà de ce plafond, la page est déclarée
 * « trop dense » (à photographier en deux moitiés).
 */
const MAX_TOKENS = 16_000;

export type LectureBordereau = { ok: true; page: PageLue; jetons: { entree: number | null; sortie: number | null } } | { ok: false; raison: "illisible" | "delai" | "dense" | "ia"; detail: string };

const SYSTEM_PROMPT = `Tu lis la photo d'une page de bordereau de tournée : toute liste imprimée des colis ou des arrêts d'une tournée de livraison ou d'enlèvement (feuille de route, bordereau de départ, liste de chargement, manifeste), quel que soit le transporteur (DPD, GLS, Chronopost, Colissimo/La Poste, Colis Privé, UPS, DHL, TNT, FedEx, Geodis, Ciblex, Heppner, Relais Colis, Mondial Relay, Amazon…) ou une liste sans marque.

Recopie fidèlement ce qui est imprimé, sans rien inventer, compléter ni corriger : un champ absent, coupé ou illisible vaut null (ou une liste vide). N'invente jamais un chiffre de code postal, de téléphone ou de numéro de colis. Tu peux omettre un champ qui vaudrait null.

lisible = false et blocs = [] seulement si la photo est trop floue, coupée ou de travers pour être lue, ou s'il n'y a aucune liste de colis ou d'arrêts. Une mise en page inconnue n'est PAS une raison de refuser : lis ce qui est lisible.

En-tête (null si absent) :
- transporteur : le nom ou logo du transporteur visible sur la page (« DPD », « GLS », « Chronopost »…).
- numero : le n° de bordereau / feuille de route / manifeste tel qu'imprimé.
- tournee : le n° ou code de tournée.
- date : la date de la tournée telle qu'imprimée.
- page : le n° de page (« Page : 3 », « 3/12 » → 3).
- total_colis / total_poids_kg : les totaux de la tournée imprimés en en-tête (pas ceux de la page).
- code_barres : les chiffres imprimés sous le code-barres principal de l'en-tête (ne décode pas les barres).

Blocs : un bloc par arrêt, dans l'ordre de la page. Selon la mise en page, un arrêt est un bloc séparé par des traits, une ligne d'un tableau en colonnes, ou plusieurs lignes (une par colis) pour la même adresse : regroupe alors ces colis dans un seul bloc. Un bloc coupé en haut ou en bas de page est lu pour la partie visible.
- position : le n° d'ordre imprimé (« Pos », « N° », « Ordre », « Séq. »), sinon null.
- codes : codes ou libellés de service imprimés pour l'arrêt, tels quels, un par élément (DPD : « CR » enlèvement, « PRE » Predict, « RDV » rendez-vous, « REL » relais ; ailleurs : « Enlèvement », « Collecte », « Point relais », « ParcelShop », « Consigne », « Rendez-vous », « Express », « 13H »…).
- nom : le destinataire (ou l'expéditeur chez qui enlever), sans le contact entre parenthèses ; contact : le contact sur place (entre parenthèses, « Att. », « Contact »).
- adresse : numéro et rue seulement (complément d'adresse inclus) ; localite : code postal et ville exactement comme imprimés, avec le préfixe pays s'il y en a un (« F-66000 PERPIGNAN », « 66000 PERPIGNAN », « .. » compris si la ville est coupée).
- telephone : tel qu'imprimé (« 04.68.00.00.00 », « +336… », « 0.. » s'il est coupé).
- expediteur : l'expéditeur / donneur d'ordre s'il est imprimé pour l'arrêt.
- colis : chaque n° de colis (suivi) imprimé, tel quel, avec son poids en kg sur la même ligne (null sinon). N° DPD : les 14 chiffres sans la lettre qui suit.
- nombre_colis / poids_total_kg : le nombre de colis et le poids de l'arrêt s'ils sont imprimés (« 3 Colis en bon état », colonne « Nb », « Qté »).
- nature : « Divers », « Pneus »… ; mentions : consignes particulières (« Emargement obligatoire… », « Contre-remboursement », « Fragile ») ; « Nom, tampons, signature » et les cases à signer ne sont PAS des mentions.
- horaires : la première ligne d'enlèvement (« Enl.: … »), de créneau ou d'horaires d'ouverture, recopiée telle quelle avec les « ~ ».
- adresse_rappel : une adresse rappelée entre crochets « [ … ] », sans les crochets.
Ignore les mentions légales (« Pour toute information sur vos données personnelles… ») et les zones de signature.`;

const n = (type: string) => ({ anyOf: [{ type }, { type: "null" }] });

const SCHEMA = {
  type: "object" as const,
  properties: {
    lisible: { type: "boolean" },
    entete: {
      type: "object",
      properties: {
        transporteur: n("string"),
        numero: n("string"),
        tournee: n("string"),
        date: n("string"),
        page: n("integer"),
        total_colis: n("integer"),
        total_poids_kg: n("number"),
        code_barres: n("string"),
      },
      required: ["transporteur", "numero", "tournee", "date", "page", "total_colis", "total_poids_kg"],
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
        // Champs secondaires facultatifs : moins de « null » à écrire, lecture plus rapide.
        required: ["position", "codes", "nom", "adresse", "localite", "telephone", "colis", "nombre_colis"],
      },
    },
  },
  required: ["lisible", "entete", "blocs"],
};

/** Erreurs passagères de l'API (surcharge, limite de débit) : un nouvel essai a des chances d'aboutir. */
const PASSAGERE = new Set([408, 429, 500, 502, 503, 504, 529]);

interface Reponse {
  stopReason: string | null;
  /** Arguments de l'outil « bordereau », texte JSON reconstitué depuis le flux. */
  outil: string | null;
  entree: number | null;
  sortie: number | null;
}

type Appel = { ok: true; reponse: Reponse } | { ok: false; status: number; detail: string };

/**
 * Corps de la requête. Forme 1 (par défaut) : outil imposé, sans
 * réflexion. Forme 2 (repli si l'API refuse la première en 400) : outil
 * proposé (« auto ») et réflexion laissée au réglage du modèle — une
 * réflexion adaptive par défaut est incompatible avec un outil imposé.
 */
function corpsRequete(imageBase64: string, mediaType: string, repli: boolean): string {
  return JSON.stringify({
    model: MODELE_BORDEREAU,
    max_tokens: MAX_TOKENS,
    // Flux SSE : grosse sortie sans attente silencieuse de plusieurs minutes.
    stream: true,
    ...(repli ? {} : { thinking: { type: "disabled" } }),
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: "Lis cette page du bordereau de tournée et rends-la en appelant l'outil « bordereau », sans rien inventer." },
        ],
      },
    ],
    tools: [{ name: "bordereau", description: "En-tête et arrêts lus sur la page du bordereau de tournée.", input_schema: SCHEMA }],
    tool_choice: repli ? { type: "auto" } : { type: "tool", name: "bordereau" },
  });
}

/** Lit le flux SSE de l'API : arguments de l'outil, raison d'arrêt, jetons. */
async function lireFlux(body: ReadableStream<Uint8Array>): Promise<Appel> {
  const reponse: Reponse = { stopReason: null, outil: null, entree: null, sortie: null };
  let indexOutil: number | null = null;
  let json = "";
  let tampon = "";
  const decodeur = new TextDecoder();
  const reader = body.getReader();
  const traiter = (evenement: string): Appel | null => {
    const data = evenement
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("");
    if (!data) return null;
    let e: {
      type?: string;
      index?: number;
      message?: { usage?: { input_tokens?: number } };
      content_block?: { type?: string; name?: string };
      delta?: { type?: string; partial_json?: string; stop_reason?: string };
      usage?: { output_tokens?: number };
      error?: { type?: string; message?: string };
    };
    try {
      e = JSON.parse(data);
    } catch {
      return null;
    }
    if (e.type === "message_start") reponse.entree = e.message?.usage?.input_tokens ?? null;
    else if (e.type === "content_block_start" && e.content_block?.type === "tool_use" && e.content_block.name === "bordereau") indexOutil = e.index ?? null;
    else if (e.type === "content_block_delta" && e.index === indexOutil && e.delta?.type === "input_json_delta") json += e.delta.partial_json ?? "";
    else if (e.type === "message_delta") {
      reponse.stopReason = e.delta?.stop_reason ?? reponse.stopReason;
      reponse.sortie = e.usage?.output_tokens ?? reponse.sortie;
    } else if (e.type === "error") {
      // Erreur au milieu du flux (surcharge…) : traitée comme une erreur HTTP passagère.
      return { ok: false, status: e.error?.type === "overloaded_error" ? 529 : 500, detail: `${e.error?.type ?? "error"}: ${e.error?.message ?? ""}`.slice(0, 500) };
    }
    return null;
  };
  for (;;) {
    const { value, done } = await reader.read();
    tampon += decodeur.decode(value, { stream: !done });
    let fin: number;
    while ((fin = tampon.indexOf("\n\n")) >= 0) {
      const erreur = traiter(tampon.slice(0, fin).replace(/\r/g, ""));
      tampon = tampon.slice(fin + 2);
      if (erreur) {
        await reader.cancel().catch(() => undefined);
        return erreur;
      }
    }
    if (done) break;
  }
  if (tampon.trim()) traiter(tampon.replace(/\r/g, ""));
  reponse.outil = indexOutil !== null ? json : null;
  return { ok: true, reponse };
}

async function appeler(apiKey: string, corps: string, fin: number): Promise<Appel> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    signal: AbortSignal.timeout(Math.max(1000, fin - Date.now())),
    body: corps,
  });
  if (!response.ok || !response.body) {
    // Corps de l'erreur (type et message de l'API, jamais la photo) : visible dans les journaux.
    return { ok: false, status: response.status, detail: (await response.text().catch(() => "")).slice(0, 500) };
  }
  return lireFlux(response.body);
}

export async function lireBordereau(imageBase64: string, mediaType: string): Promise<LectureBordereau> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, raison: "ia", detail: "ANTHROPIC_API_KEY is not configured" };
  const fin = Date.now() + DELAI_LECTURE_MS;

  let reponse: Reponse | null = null;
  let repli = false;
  let nouvelEssai = false;
  for (;;) {
    let appel: Appel;
    try {
      appel = await appeler(apiKey, corpsRequete(imageBase64, mediaType, repli), fin);
    } catch (e) {
      const delai = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      return { ok: false, raison: delai ? "delai" : "ia", detail: e instanceof Error ? e.message : "network error" };
    }
    if (appel.ok) {
      reponse = appel.reponse;
      break;
    }
    console.error(`bordereau: API ${appel.status}${repli ? " (forme de repli)" : ""}`, appel.detail);
    // Requête refusée (400) : un seul essai avec la forme de repli.
    if (appel.status === 400 && !repli) {
      repli = true;
      continue;
    }
    // Erreur passagère : un seul nouvel essai, s'il reste largement le temps de lire la page.
    if (!nouvelEssai && PASSAGERE.has(appel.status) && fin - Date.now() > 200_000) {
      nouvelEssai = true;
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    return { ok: false, raison: "ia", detail: `Anthropic API error ${appel.status}: ${appel.detail.slice(0, 300)}` };
  }

  const usage = `${reponse.entree ?? "?"} jetons lus, ${reponse.sortie ?? "?"} écrits`;
  if (reponse.stopReason === "max_tokens") return { ok: false, raison: "dense", detail: `réponse coupée (max_tokens, ${usage})` };
  if (reponse.outil === null) return { ok: false, raison: "ia", detail: `réponse IA sans outil (stop_reason ${reponse.stopReason ?? "?"}, ${usage})` };
  let input: unknown;
  try {
    input = JSON.parse(reponse.outil || "{}");
  } catch {
    return { ok: false, raison: "ia", detail: `arguments de l'outil illisibles (${usage})` };
  }
  const parsed = pageLueSchema.safeParse(input);
  if (!parsed.success) return { ok: false, raison: "ia", detail: `sortie non conforme (${usage}) : ${parsed.error.message.slice(0, 300)}` };
  // Une page sans arrêt n'est gardée que si son en-tête est lu (page de garde, récapitulatif).
  if (!parsed.data.blocs.length && (!parsed.data.lisible || !parsed.data.entete.numero)) return { ok: false, raison: "illisible", detail: "page illisible" };
  return { ok: true, page: parsed.data, jetons: { entree: reponse.entree, sortie: reponse.sortie } };
}
