import "server-only";
import type { Point } from "@/lib/colis/optimisation";
import { convertirHorairesOSM, type Semaine } from "@/lib/colis/horaires";

export type AdresseOSM = { id: string; address: string; lat: number; lng: number };
export type ResultatHorairesOSM = { nom: string; horaires: string | null; semaine: Semaine | null };

type ElementOSM = {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
};

function distanceMetres(a: Point, b: Point): number {
  const rad = (n: number) => n * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Recherche les horaires OSM de plusieurs arrêts en une seule requête gratuite. */
export async function rechercherHorairesOSMPlusieurs(adresses: AdresseOSM[]): Promise<Map<string, ResultatHorairesOSM>> {
  const resultats = new Map<string, ResultatHorairesOSM>();
  const points = adresses.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lng) && Math.abs(a.lat) <= 90 && Math.abs(a.lng) <= 180);
  if (!points.length) return resultats;

  // Limiter la taille de la requête et les sollicitations du service public.
  const lot = points.slice(0, 40);
  const blocs = lot.map((a) => `nwr(around:35,${a.lat},${a.lng})["opening_hours"]["name"];`).join("\n");
  const query = `[out:json][timeout:15];(${blocs});out center tags;`;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "GODAC/1.0 (free OpenStreetMap data)" },
      body: new URLSearchParams({ data: query }),
      cache: "no-store",
      signal: AbortSignal.timeout(18000),
    });
    if (!response.ok) return resultats;
    const payload = await response.json() as { elements?: ElementOSM[] };
    const elements = (payload.elements ?? []).filter((e) => e.tags?.name && e.tags?.opening_hours);

    for (const adresse of lot) {
      let meilleur: { element: ElementOSM; distance: number } | null = null;
      for (const element of elements) {
        const lat = element.lat ?? element.center?.lat;
        const lng = element.lon ?? element.center?.lon;
        if (lat === undefined || lng === undefined) continue;
        const d = distanceMetres({ lat: adresse.lat, lng: adresse.lng }, { lat, lng });
        if (d <= 35 && (!meilleur || d < meilleur.distance)) meilleur = { element, distance: d };
      }
      if (!meilleur) continue;
      const horaires = meilleur.element.tags?.opening_hours ?? null;
      resultats.set(adresse.id, {
        nom: meilleur.element.tags?.name ?? adresse.address,
        horaires,
        semaine: convertirHorairesOSM(horaires),
      });
    }
  } catch {
    // Overpass peut être indisponible : les horaires manuels continuent de fonctionner.
  }
  return resultats;
}
