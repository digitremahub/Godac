
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleAdresse } from "@/lib/colis/serveur";
import { normaliserSemaine, type Semaine } from "@/lib/colis/horaires";

type Periode = {
  open?: { day?: number; time?: string };
  close?: { day?: number; time?: string };
};

type PlaceResult = {
  place_id?: string;
  name?: string;
  business_status?: string;
  opening_hours?: { periods?: Periode[] };
  geometry?: { location?: { lat?: number; lng?: number } };
};

function heureGoogle(v: string | undefined, defaut: string): string {
  if (!v || !/^\d{4}$/.test(v)) return defaut;
  return `${v.slice(0, 2)}:${v.slice(2, 4)}`;
}

function semaineGoogle(periodes: Periode[]): Semaine {
  const jours: Record<string, { open: string; close: string }[]> = {
    "1": [], "2": [], "3": [], "4": [], "5": [], "6": [], "7": [],
  };

  for (const p of periodes) {
    const ouverture = p.open;
    if (ouverture?.day === undefined) continue;

    const jour = ouverture.day === 0 ? 7 : ouverture.day;
    const fermeture = p.close;
    const close =
      fermeture && fermeture.day === ouverture.day
        ? heureGoogle(fermeture.time, "23:59")
        : "23:59";
    const open = heureGoogle(ouverture.time, "00:00");

    if (open < close) jours[String(jour)]!.push({ open, close });
  }

  return normaliserSemaine(jours);
}

export async function importerHorairesProfessionnels(params: {
  supabase: SupabaseClient;
  organizationId: string;
  userId: string;
  address: string;
  lat: number | null;
  lng: number | null;
}): Promise<{ nom: string; horairesTrouves: boolean } | null> {
  const key =
    process.env.GOOGLE_PLACES_API_KEY ??
    process.env.GOOGLE_MAPS_API_KEY;

  if (!key || params.lat === null || params.lng === null) return null;

  const addressKey = cleAdresse(params.address);
  if (!addressKey) return null;

  const { data: existante } = await params.supabase
    .from("delivery_address_hours")
    .select("id")
    .eq("organization_id", params.organizationId)
    .eq("address_key", addressKey)
    .maybeSingle();

  if (existante) return null;

  try {
    const url = new URL(
      "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
    );
    url.searchParams.set("input", params.address);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set(
      "fields",
      "place_id,name,business_status,opening_hours,geometry"
    );
    url.searchParams.set(
      "locationbias",
      `point:${params.lat},${params.lng}`
    );
    url.searchParams.set("key", key);

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      status?: string;
      candidates?: PlaceResult[];
    };

    const place = payload.candidates?.[0];

    if (
      payload.status !== "OK" ||
      !place?.place_id ||
      !place.name ||
      place.business_status === "CLOSED_PERMANENTLY"
    ) {
      return null;
    }

    const position = place.geometry?.location;

    if (
      typeof position?.lat === "number" &&
      typeof position.lng === "number"
    ) {
      const rad = (n: number) => (n * Math.PI) / 180;
      const dLat = rad(position.lat - params.lat);
      const dLng = rad(position.lng - params.lng);
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(params.lat)) *
          Math.cos(rad(position.lat)) *
          Math.sin(dLng / 2) ** 2;

      const distanceKm =
        6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));

      if (distanceKm > 0.2) return null;
    }

    const periodes = place.opening_hours?.periods;

    if (!periodes?.length) {
      return { nom: place.name, horairesTrouves: false };
    }

    const weekly = semaineGoogle(periodes);

    if (!Object.keys(weekly).length) {
      return { nom: place.name, horairesTrouves: false };
    }

    const { error } = await params.supabase
      .from("delivery_address_hours")
      .upsert(
        {
          organization_id: params.organizationId,
          address_key: addressKey,
          address: params.address,
          label: place.name,
          weekly_schedule: weekly,
          notes:
            "Horaires récupérés automatiquement via Google Places ; vérifiez-les en cas de doute.",
          updated_by: params.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,address_key" }
      );

    if (error) return null;

    return { nom: place.name, horairesTrouves: true };
  } catch {
    return null;
  }
}
