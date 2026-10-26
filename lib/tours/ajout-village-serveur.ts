/**
 * Recherche de communes pour l'ajout d'un village — API officielle
 * geo.api.gouv.fr (gratuite, sans clé), appelée côté serveur : réponse mise
 * en cache une heure par Next et délai maximal de 4 s.
 */
import { analyserSaisie, saisieRecherchable, suggestionsDepuisCommunes, type CommuneApi, type SuggestionCommune } from "@/lib/tours/ajout-village";

const CHAMPS = "nom,code,codesPostaux,centre,departement";

async function appeler(params: string, delaiMs: number): Promise<CommuneApi[] | null> {
  try {
    const res = await fetch(`https://geo.api.gouv.fr/communes?${params}&fields=${CHAMPS}&boost=population&limit=30`, {
      signal: AbortSignal.timeout(delaiMs),
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as unknown;
    return Array.isArray(json) ? (json as CommuneApi[]) : null;
  } catch {
    return null;
  }
}

/** `indisponible` : le service n'a pas répondu (à distinguer de « aucune commune »). */
export async function chercherSuggestionsCommunes(texte: string, delaiMs = 4000): Promise<{ results: SuggestionCommune[]; indisponible: boolean }> {
  const saisie = analyserSaisie(texte);
  if (!saisieRecherchable(saisie)) return { results: [], indisponible: false };
  const nom = saisie.nom ? `nom=${encodeURIComponent(saisie.nom)}` : "";
  const cp = saisie.codePostal ? `codePostal=${saisie.codePostal}` : "";
  let communes = await appeler([nom, cp].filter(Boolean).join("&"), delaiMs);
  // Nom + code postal sans résultat : on retombe sur le nom seul (code postal erroné).
  if (communes && !communes.length && nom && cp) communes = await appeler(nom, delaiMs);
  if (communes === null) return { results: [], indisponible: true };
  return { results: suggestionsDepuisCommunes(communes, saisie), indisponible: false };
}
