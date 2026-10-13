/**
 * Localisation d'une commune française par son nom — API officielle
 * geo.api.gouv.fr (gratuite, sans clé). Sert à placer les villages des
 * tournées sur la carte (/tours/routes). Le choix entre homonymes
 * (« Saint-Martin »…) est une fonction pure, testée à part.
 */
import { haversineKm, normalizeVillageName, type LngLat } from "@/lib/tours/carte-villages";

export interface CommuneCandidate {
  nom: string;
  code: string;
  codesPostaux?: string[];
  centre?: { type: "Point"; coordinates: LngLat } | null;
  departement?: { code: string; nom: string } | null;
}

export interface CommuneHint {
  /** Code postal saisi sur le village. */
  postalCode?: string | null;
  /** Dépôt du service (ou de l'organisation) : coordonnées… */
  depot?: { lat: number; lng: number } | null;
  /** …et/ou code postal tiré de son adresse. */
  depotPostalCode?: string | null;
}

export interface CommuneMatch {
  lat: number;
  lng: number;
  inseeCode: string;
  nom: string;
}

/** Département d'un code postal (Corse 20 → 2A/2B, outre-mer 97x). */
export function departementsFromPostalCode(cp: string | null | undefined): string[] {
  const c = (cp ?? "").trim();
  if (!/^\d{5}$/.test(c)) return [];
  if (c.startsWith("97") || c.startsWith("98")) return [c.slice(0, 3)];
  if (c.startsWith("20")) return ["2A", "2B"];
  return [c.slice(0, 2)];
}

/** Premier code postal (5 chiffres) d'une adresse libre. */
export function postalCodeFromAddress(address: string | null | undefined): string | null {
  return (address ?? "").match(/\b(\d{5})\b/)?.[1] ?? null;
}

/**
 * Choisit la commune parmi les résultats de l'API (déjà triés par
 * pertinence puis population) : nom exact d'abord ; puis code postal
 * du village ; puis département du village ; puis la plus proche du
 * dépôt ; puis département du dépôt ; sinon la première.
 */
export function chooseCommune(name: string, candidates: CommuneCandidate[], hint: CommuneHint = {}): CommuneMatch | null {
  const withCentre = candidates.filter((c) => c.centre?.coordinates?.length === 2);
  if (!withCentre.length) return null;
  const target = normalizeVillageName(name);
  const exact = withCentre.filter((c) => normalizeVillageName(c.nom) === target);
  let pool = exact.length ? exact : withCentre;

  const cp = hint.postalCode?.trim();
  const byCp = cp ? pool.filter((c) => c.codesPostaux?.includes(cp)) : [];
  if (byCp.length) pool = byCp;
  else {
    const deps = departementsFromPostalCode(cp);
    const byDep = deps.length ? pool.filter((c) => c.departement && deps.includes(c.departement.code)) : [];
    if (byDep.length) pool = byDep;
    else if (hint.depot && pool.length > 1) {
      const d: LngLat = [hint.depot.lng, hint.depot.lat];
      pool = [...pool].sort((a, b) => haversineKm(d, a.centre!.coordinates) - haversineKm(d, b.centre!.coordinates));
    } else {
      const depotDeps = departementsFromPostalCode(hint.depotPostalCode);
      const byDepotDep = depotDeps.length ? pool.filter((c) => c.departement && depotDeps.includes(c.departement.code)) : [];
      if (byDepotDep.length) pool = byDepotDep;
    }
  }
  const best = pool[0]!;
  const [lng, lat] = best.centre!.coordinates;
  return { lat, lng, inseeCode: best.code, nom: best.nom };
}

const FIELDS = "nom,code,codesPostaux,centre,departement";

/**
 * Recherche réseau. Renvoie `null` si le réseau / l'API est indisponible
 * (à réessayer plus tard), `[]` si aucune commune ne correspond.
 */
export async function searchCommunes(name: string, postalCode?: string | null, timeoutMs = 6000): Promise<CommuneCandidate[] | null> {
  async function get(params: string): Promise<CommuneCandidate[] | null> {
    try {
      const res = await fetch(`https://geo.api.gouv.fr/communes?${params}&fields=${FIELDS}&boost=population&limit=5`, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) return null;
      const json = (await res.json()) as unknown;
      return Array.isArray(json) ? (json as CommuneCandidate[]) : null;
    } catch {
      return null;
    }
  }
  const nom = `nom=${encodeURIComponent(name.trim())}`;
  const cp = postalCode?.trim();
  if (cp && /^\d{5}$/.test(cp)) {
    const strict = await get(`${nom}&codePostal=${cp}`);
    if (strict === null) return null;
    if (strict.length) return strict;
  }
  return get(nom);
}
