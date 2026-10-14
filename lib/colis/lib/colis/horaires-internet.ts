
import "server-only";

export type HorairesOSM = {
  nom: string;
  horaires: string | null;
  source: "OpenStreetMap";
};

export async function rechercherHorairesOSM(params: {
  address: string;
  lat: number;
  lng: number;
}): Promise<HorairesOSM | null> {
  const { lat, lng } = params;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null;
  }

  try {
    const query = `
      [out:json][timeout:8];
      (
        node(around:60,${lat},${lng})["shop"];
        node(around:60,${lat},${lng})["office"];
        node(around:60,${lat},${lng})["amenity"~"restaurant|cafe|pharmacy|bank|post_office"];
        way(around:60,${lat},${lng})["shop"];
        way(around:60,${lat},${lng})["office"];
        way(around:60,${lat},${lng})["amenity"~"restaurant|cafe|pharmacy|bank|post_office"];
      );
      out center tags;
    `;

    const response = await fetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GODAC/1.0",
        },
        body: new URLSearchParams({ data: query }),
        cache: "no-store",
        signal: AbortSignal.timeout(9000),
      }
    );

    if (!response.ok) return null;

    const data = (await response.json()) as {
      elements?: {
        tags?: Record<string, string>;
        lat?: number;
        lon?: number;
        center?: { lat?: number; lon?: number };
      }[];
    };

    const elements = data.elements ?? [];

    const candidats = elements
      .map((element) => {
        const pLat = element.lat ?? element.center?.lat;
        const pLng = element.lon ?? element.center?.lon;

        if (
          pLat === undefined ||
          pLng === undefined ||
          !element.tags?.name
        ) {
          return null;
        }

        const distance = Math.hypot(
          (pLat - lat) * 111,
          (pLng - lng) * 111 * Math.cos((lat * Math.PI) / 180)
        );

        return { element, distance };
      })
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== null && item.distance <= 0.06
      )
      .sort((a, b) => a.distance - b.distance);

    const meilleur = candidats[0]?.element;
    if (!meilleur?.tags?.name) return null;

    return {
      nom: meilleur.tags.name,
      horaires: meilleur.tags.opening_hours ?? null,
      source: "OpenStreetMap",
    };
  } catch {
    return null;
  }
}
