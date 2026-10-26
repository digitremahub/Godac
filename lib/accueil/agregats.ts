/**
 * Agrégats de l'accueil direction renvoyés par la fonction SQL
 * accueil_direction_agregats (migration 20261106000003) : lecture
 * défensive de la réponse JSON. Fichier pur, testé dans
 * lib/accueil/__tests__/agregats.test.ts. Réponse absente ou mal formée :
 * null, et l'accueil retombe sur l'ancien calcul.
 */

export interface DonneeBarre {
  name: string;
  value: number;
}

export interface AgregatsDirection {
  coutMois: number;
  coutParVehicule: DonneeBarre[];
  tourneesParService: DonneeBarre[];
}

function barres(v: unknown): DonneeBarre[] | null {
  if (!Array.isArray(v)) return null;
  return v.map((x) => ({ name: String((x as { name?: unknown })?.name ?? "—"), value: Number((x as { value?: unknown })?.value ?? 0) || 0 }));
}

export function lireAgregats(json: unknown): AgregatsDirection | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const coutParVehicule = barres(j.cout_par_vehicule);
  const tourneesParService = barres(j.tournees_par_service);
  const cout = Number(j.cout_mois);
  if (!coutParVehicule || !tourneesParService || !Number.isFinite(cout)) return null;
  return { coutMois: cout, coutParVehicule, tourneesParService };
}
