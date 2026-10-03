import "server-only";

/**
 * Turns a free-text French address into coordinates, via the
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

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

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
