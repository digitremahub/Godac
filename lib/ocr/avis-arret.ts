import "server-only";
import { z } from "zod";

/**
 * Lecture d'une photo d'avis d'arrêt de travail (volets 2 et 3, destinés
 * à l'employeur) pour PRÉ-REMPLIR la déclaration du salarié, qui
 * confirme. Même approche que lib/ocr/fine.ts : appel direct à l'API,
 * outil imposé, jamais d'exception.
 *
 * Données lues : dates, type (maladie, accident du travail…), initial ou
 * prolongation. JAMAIS de diagnostic ni d'élément médical : ils ne sont
 * ni demandés au modèle ni conservés. Si la photo montre le volet 1
 * (éléments médicaux), le modèle le signale et la photo est supprimée
 * par l'appelant.
 */

export const MODELE_AVIS_ARRET = "claude-sonnet-5";

export const lectureAvisSchema = z.object({
  lisible: z.boolean(),
  volet_medical: z.boolean().nullable().optional().default(null),
  type: z.enum(["maladie", "at_mp", "trajet", "maternite", "paternite"]).nullable(),
  prolongation: z.boolean().nullable(),
  du: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  au: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
});

export type LectureAvis = z.infer<typeof lectureAvisSchema>;

export type ResultatLectureAvis = { ok: true; champs: LectureAvis } | { ok: false; raison: string };

const SYSTEM_PROMPT = `Tu lis la photo d'un avis d'arrêt de travail français (cerfa « avis d'arrêt de travail » ou certificat d'accident du travail / maladie professionnelle), volet destiné à l'employeur. Tu ne relèves QUE : la date de début de l'arrêt, la date de fin (« jusqu'au »), s'il s'agit d'un arrêt initial ou d'une prolongation, et la nature : maladie, accident du travail ou maladie professionnelle (at_mp), accident de trajet (trajet), maternité, paternité. Ne relève, ne recopie et ne résume JAMAIS un diagnostic, un motif médical, des éléments médicaux, un nom de médecin ou un numéro de sécurité sociale. Si la photo montre des éléments d'ordre médical (volet 1, réservé au service médical), indique volet_medical = true et ne relève rien d'autre. Valeur absente, floue ou incertaine : null, ne devine jamais. Dates au format YYYY-MM-DD.`;

const SCHEMA_OUTIL = {
  type: "object" as const,
  properties: {
    lisible: { type: "boolean", description: "La photo est-elle un avis d'arrêt de travail lisible ?" },
    volet_medical: { anyOf: [{ type: "boolean" }, { type: "null" }], description: "La photo montre des éléments médicaux (volet 1)." },
    type: { anyOf: [{ type: "string", enum: ["maladie", "at_mp", "trajet", "maternite", "paternite"] }, { type: "null" }] },
    prolongation: { anyOf: [{ type: "boolean" }, { type: "null" }], description: "Case « prolongation » cochée." },
    du: { anyOf: [{ type: "string" }, { type: "null" }], description: "Début de l'arrêt, YYYY-MM-DD." },
    au: { anyOf: [{ type: "string" }, { type: "null" }], description: "Fin de l'arrêt (jusqu'au), YYYY-MM-DD." },
  },
  required: ["lisible", "volet_medical", "type", "prolongation", "du", "au"],
};

function typeMedia(nom: string): string {
  const n = nom.toLowerCase();
  if (n.endsWith(".pdf")) return "application/pdf";
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/** Corps de la requête (exporté pour les tests) : outil imposé, sans réflexion, sortie courte. */
export function corpsLectureAvis(octetsBase64: string, nom: string): Record<string, unknown> {
  const media = typeMedia(nom);
  return {
    model: MODELE_AVIS_ARRET,
    max_tokens: 400,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          media === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: media, data: octetsBase64 } }
            : { type: "image", source: { type: "base64", media_type: media, data: octetsBase64 } },
          { type: "text", text: "Relève les dates, la nature et initial / prolongation de cet avis via l'outil fourni. Aucun élément médical." },
        ],
      },
    ],
    tools: [{ name: "avis_arret", description: "Dates et nature lues sur l'avis d'arrêt (aucune donnée médicale).", input_schema: SCHEMA_OUTIL }],
    tool_choice: { type: "tool", name: "avis_arret" },
  };
}

/** Réponse de l'API → champs validés (exportée pour les tests). Une date incohérente est écartée. */
export function lireReponseAvis(data: { content?: { type: string; name?: string; input?: unknown }[] }): ResultatLectureAvis {
  const outil = data.content?.find((c) => c.type === "tool_use" && c.name === "avis_arret");
  if (!outil) return { ok: false, raison: "Lecture impossible : réponse inattendue." };
  const brut = (outil.input ?? {}) as Record<string, unknown>;
  // Dates mal formées : ignorées plutôt que de rejeter toute la lecture.
  const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  const parsed = lectureAvisSchema.safeParse({ ...brut, du: date(brut.du), au: date(brut.au) });
  if (!parsed.success) return { ok: false, raison: "Lecture impossible : réponse mal formée." };
  const c = parsed.data;
  if (c.volet_medical) return { ok: true, champs: { lisible: c.lisible, volet_medical: true, type: null, prolongation: null, du: null, au: null } };
  return { ok: true, champs: c.du && c.au && c.au < c.du ? { ...c, au: null } : c };
}

export async function lireAvisArret(octets: Buffer, nom: string): Promise<ResultatLectureAvis> {
  const cle = process.env.ANTHROPIC_API_KEY;
  if (!cle) return { ok: false, raison: "Lecture automatique non configurée." };
  let reponse: Response;
  try {
    reponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cle, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(corpsLectureAvis(octets.toString("base64"), nom)),
    });
  } catch {
    return { ok: false, raison: "Lecture automatique indisponible (réseau)." };
  }
  if (!reponse.ok) {
    console.error("ocr avis d'arrêt :", reponse.status, (await reponse.text()).slice(0, 300));
    return { ok: false, raison: "Lecture automatique indisponible pour le moment." };
  }
  return lireReponseAvis((await reponse.json()) as { content?: { type: string; name?: string; input?: unknown }[] });
}
