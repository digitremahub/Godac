import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { codePays } from "@/lib/pays/serveur";
import {
  depuisPhoton,
  filtrerAnnuaire,
  fusionnerSuggestions,
  lireBiais,
  type EntreeAnnuaire,
  type ProprietesPhoton,
  type SuggestionAdresse,
} from "@/lib/colis/recherche-adresses";

export const dynamic = "force-dynamic";

const UA = "GODAC/1.0 (recherche d'adresses et d'établissements ; https://godac-v2.vercel.app)";

/**
 * Champ adresse de la tournée colis : adresses postales ET établissements
 * par leur nom (« Pharmacie du Centre Saint-X »). Annuaire interne de
 * l'entreprise, puis OpenStreetMap (Photon, biaisé autour de `lat`/`lng` :
 * dépôt ou chauffeur), Base Adresse Nationale en France, et Google Places
 * seulement si GOOGLE_PLACES_API_KEY est configurée. Une source en panne
 * n'empêche jamais les autres de répondre.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 160) return NextResponse.json({ resultats: [] });
  const biais = lireBiais(url.searchParams.get("lat"), url.searchParams.get("lng"));
  const pays = await codePays(appUser.organization_id).catch(() => "FR");

  const [annuaire, osm, ban, google] = await Promise.all([
    annuaireInterne(supabase, appUser.organization_id, q),
    photon(q, biais, pays),
    pays === "FR" ? baseAdresseNationale(q, biais) : Promise.resolve([]),
    googlePlaces(q, biais, pays),
  ]);
  return NextResponse.json({ resultats: fusionnerSuggestions(annuaire, [osm, ban, google]) });
}

type Client = Awaited<ReturnType<typeof garderApi>> extends infer R ? (R extends { ok: true; supabase: infer S } ? S : never) : never;

/** Annuaire de l'entreprise : fiches horaires nommées et noms d'établissements des arrêts passés. */
async function annuaireInterne(supabase: Client, organizationId: string, q: string): Promise<SuggestionAdresse[]> {
  try {
    const motif = `%${q.replace(/[%_,()]/g, " ").trim().split(/\s+/)[0] ?? ""}%`;
    const [{ data: fiches }, { data: arrets }] = await Promise.all([
      supabase.from("delivery_address_hours").select("label, address").eq("organization_id", organizationId).or(`label.ilike.${motif},address.ilike.${motif}`).limit(40),
      supabase
        .from("delivery_stops")
        .select("business_name, address, lat, lng")
        .eq("organization_id", organizationId)
        .not("business_name", "is", null)
        .or(`business_name.ilike.${motif},address.ilike.${motif}`)
        .order("created_at", { ascending: false })
        .limit(60),
    ]);
    const entrees: EntreeAnnuaire[] = [
      ...(fiches ?? []).map((f: { label: string | null; address: string }) => ({ nom: f.label, adresse: f.address })),
      ...(arrets ?? []).map((a: { business_name: string | null; address: string; lat: number | null; lng: number | null }) => ({ nom: a.business_name, adresse: a.address, lat: a.lat, lng: a.lng })),
    ];
    return filtrerAnnuaire(entrees, q, 4);
  } catch {
    return [];
  }
}

async function photon(q: string, biais: { lat: number; lng: number } | null, pays: string): Promise<SuggestionAdresse[]> {
  try {
    const p = new URLSearchParams({ q, limit: "10", lang: "fr" });
    if (biais) {
      p.set("lat", String(biais.lat));
      p.set("lon", String(biais.lng));
      p.set("location_bias_scale", "0.4");
    } else {
      p.set("lat", "46.6");
      p.set("lon", "2.5");
    }
    const res = await fetch(`https://photon.komoot.io/api/?${p.toString()}`, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(4000), next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: ProprietesPhoton & { countrycode?: string }; geometry?: { coordinates?: [number, number] } }[] };
    return (data.features ?? [])
      .filter((f) => !f.properties?.countrycode || f.properties.countrycode.toUpperCase() === pays.toUpperCase())
      .map((f) => depuisPhoton(f.properties ?? {}, f.geometry?.coordinates))
      .filter((s): s is SuggestionAdresse => s !== null);
  } catch {
    return [];
  }
}

async function baseAdresseNationale(q: string, biais: { lat: number; lng: number } | null): Promise<SuggestionAdresse[]> {
  try {
    const p = new URLSearchParams({ q, limit: "5", autocomplete: "1" });
    if (biais) {
      p.set("lat", String(biais.lat));
      p.set("lon", String(biais.lng));
    }
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${p.toString()}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000), next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: { label?: string }; geometry?: { coordinates?: [number, number] } }[] };
    return (data.features ?? [])
      .filter((f) => f.properties?.label)
      .map((f) => ({ type: "adresse" as const, nom: null, adresse: f.properties!.label!, lat: f.geometry?.coordinates?.[1] ?? null, lng: f.geometry?.coordinates?.[0] ?? null, source: "ban" as const }));
  } catch {
    return [];
  }
}

/** Google Places Autocomplete (API « Places (New) »), seulement avec une clé. Coordonnées : géocodées à l'ajout. */
async function googlePlaces(q: string, biais: { lat: number; lng: number } | null, pays: string): Promise<SuggestionAdresse[]> {
  const cle = process.env.GOOGLE_PLACES_API_KEY;
  if (!cle) return [];
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cle },
      body: JSON.stringify({
        input: q,
        languageCode: "fr",
        includedRegionCodes: [pays.toLowerCase()],
        ...(biais ? { locationBias: { circle: { center: { latitude: biais.lat, longitude: biais.lng }, radius: 30000 } } } : {}),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { suggestions?: { placePrediction?: { types?: string[]; structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } } } }[] };
    return (data.suggestions ?? [])
      .map((s) => s.placePrediction)
      .filter((p): p is NonNullable<typeof p> => Boolean(p?.structuredFormat?.mainText?.text && p.structuredFormat.secondaryText?.text))
      .map((p) => {
        const etablissement = (p.types ?? []).includes("establishment");
        const principal = p.structuredFormat!.mainText!.text!;
        const secondaire = p.structuredFormat!.secondaryText!.text!;
        return etablissement
          ? { type: "etablissement" as const, nom: principal, adresse: secondaire, lat: null, lng: null, source: "google" as const }
          : { type: "adresse" as const, nom: null, adresse: `${principal}, ${secondaire}`, lat: null, lng: null, source: "google" as const };
      });
  } catch {
    return [];
  }
}
