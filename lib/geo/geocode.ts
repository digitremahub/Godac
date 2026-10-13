import "server-only";

/**
 * Turns a free-text address into coordinates — French addresses via the
 * government's own geocoding API (api-adresse.data.gouv.fr) — free,
 * no API key, no account to configure, consistent with how this app
 * only ever adds a paid/keyed integration when there's no equivalent
 * free one (see README "Intégrations non branchées"). Only ever used
 * for the depot address and a driver's own home address — never
 * exposed to other organizations, never used for anything beyond the
 * straight-line distance in lib/business/fuel-profitability.ts.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
}

/**
 * Hors de France, la Base Adresse Nationale ne connaît pas l'adresse (et
 * pourrait la confondre avec une rue française du même nom) : on passe
 * par OpenStreetMap (Nominatim), limité au pays de l'entreprise.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = { "User-Agent": "GODAC (https://godac.app; contact@godac.fr)", "Accept-Language": "fr" };

async function geocodeNominatim(address: string, country: string): Promise<GeocodeResult | null> {
  try {
    const res = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=1&countrycodes=${country.toLowerCase()}&q=${encodeURIComponent(address)}`, {
      headers: NOMINATIM_HEADERS,
    });
    if (!res.ok) return null;
    const [hit] = (await res.json()) as { lat?: string; lon?: string }[];
    return hit?.lat && hit.lon ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string, country = "FR"): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;
  if (country !== "FR") return geocodeNominatim(trimmed, country);

  let response: Response;
  try {
    response = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(trimmed)}&limit=1`);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const data = (await response.json()) as {
    features?: { geometry?: { coordinates?: [number, number] } }[];
  };
  const coordinates = data.features?.[0]?.geometry?.coordinates;
  if (!coordinates || coordinates.length !== 2) return null;

  const [lng, lat] = coordinates;
  return { lat, lng };
}

/** Adresse la plus proche d'un point (arrêts importés avec seulement des coordonnées). */
export async function reverseGeocode(lat: number, lng: number, country = "FR"): Promise<string | null> {
  if (country !== "FR") {
    try {
      const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: NOMINATIM_HEADERS });
      return res.ok ? (((await res.json()) as { display_name?: string }).display_name ?? null) : null;
    } catch {
      return null;
    }
  }
  let response: Response;
  try {
    response = await fetch(`https://api-adresse.data.gouv.fr/reverse/?lon=${lng}&lat=${lat}&limit=1`);
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const data = (await response.json()) as { features?: { properties?: { label?: string } }[] };
  return data.features?.[0]?.properties?.label ?? null;
}
