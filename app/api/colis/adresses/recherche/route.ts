import { NextResponse } from "next/server";
import { garderApi } from "@/lib/acces/garde-api";
import { codePays } from "@/lib/pays/serveur";
import {
  depuisPhoton,
  filtrerAnnuaire,
  lireBiais,
  ordonnerRapide,
  type EntreeAnnuaire,
  type ProprietesPhoton,
  type SuggestionAdresse,
} from "@/lib/colis/recherche-adresses";
import { cleGoogle, corpsAutocomplete, lireAutocomplete, MASQUE_AUTOCOMPLETE, sessionValide, URL_AUTOCOMPLETE } from "@/lib/colis/places-google";

export const dynamic = "force-dynamic";

const UA = "GODAC/1.0 (recherche d'adresses et d'établissements ; https://godac-v2.vercel.app)";
/** Au-delà, une source facultative est abandonnée : elle ne doit jamais retarder la saisie. */
const DELAI_RAPIDE_MS = 1200;
const DELAI_ANNUAIRE_MS = 700;
const DELAI_COMPLEMENT_MS = 1500;

/**
 * Champ adresse de la tournée colis, en deux temps.
 *  - `phase=rapide` (défaut) : Google Places Autocomplete si une clé existe
 *    (GOOGLE_PLACES_API_KEY ou GOOGLE_MAPS_API_KEY), sinon la Base Adresse
 *    Nationale (France), plus l'annuaire interne si il répond en < 0,7 s.
 *    Les coordonnées Google sont résolues au choix (/api/colis/adresses/detail).
 *  - `phase=complement` (sans clé Google seulement) : OpenStreetMap (Photon,
 *    plus lent), timeout 1,5 s, que le client ajoute à la liste affichée.
 * Une source en panne ou lente ne bloque jamais la réponse.
 */
export async function GET(req: Request) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const { appUser, supabase } = g;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3 || q.length > 160) return NextResponse.json({ resultats: [], complement: false });
  const biais = lireBiais(url.searchParams.get("lat"), url.searchParams.get("lng"));
  const session = url.searchParams.get("session");
  const phase = url.searchParams.get("phase") === "complement" ? "complement" : "rapide";
  const cle = cleGoogle(process.env);
  const pays = await codePays(appUser.organization_id).catch(() => "FR");

  if (phase === "complement") {
    if (cle) return NextResponse.json({ resultats: [], complement: false });
    return NextResponse.json({ resultats: await photon(q, biais, pays), complement: false });
  }

  const [annuaire, principal] = await Promise.all([
    delai(annuaireInterne(supabase, appUser.organization_id, q), DELAI_ANNUAIRE_MS),
    cle ? googlePlaces(cle, q, biais, pays, sessionValide(session) ? session : null) : pays === "FR" ? baseAdresseNationale(q, biais) : Promise.resolve([]),
  ]);
  // Sans clé Google : le client enchaîne sur la phase « complement » (établissements OSM).
  return NextResponse.json({ resultats: ordonnerRapide(annuaire, principal), complement: !cle });
}

/** Résultat de repli si la source dépasse le délai (sans l'annuler : elle se termine seule). */
function delai(p: Promise<SuggestionAdresse[]>, ms: number): Promise<SuggestionAdresse[]> {
  return Promise.race([p, new Promise<SuggestionAdresse[]>((r) => setTimeout(() => r([]), ms))]);
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
    const res = await fetch(`https://photon.komoot.io/api/?${p.toString()}`, { headers: { Accept: "application/json", "User-Agent": UA }, signal: AbortSignal.timeout(DELAI_COMPLEMENT_MS), next: { revalidate: 60 } });
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
    const p = new URLSearchParams({ q, limit: "6", autocomplete: "1" });
    if (biais) {
      p.set("lat", String(biais.lat));
      p.set("lon", String(biais.lng));
    }
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?${p.toString()}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(DELAI_RAPIDE_MS), next: { revalidate: 60 } });
    if (!res.ok) return [];
    const data = (await res.json()) as { features?: { properties?: { label?: string }; geometry?: { coordinates?: [number, number] } }[] };
    return (data.features ?? [])
      .filter((f) => f.properties?.label)
      .map((f) => ({ type: "adresse" as const, nom: null, adresse: f.properties!.label!, lat: f.geometry?.coordinates?.[1] ?? null, lng: f.geometry?.coordinates?.[0] ?? null, source: "ban" as const }));
  } catch {
    return [];
  }
}

/** Google Places Autocomplete (API « Places (New) »), biaisé autour du dépôt. Pas de coordonnées ici. */
async function googlePlaces(cle: string, q: string, biais: { lat: number; lng: number } | null, pays: string, session: string | null): Promise<SuggestionAdresse[]> {
  try {
    const res = await fetch(URL_AUTOCOMPLETE, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cle, "X-Goog-FieldMask": MASQUE_AUTOCOMPLETE },
      body: JSON.stringify(corpsAutocomplete(q, pays, biais, session)),
      signal: AbortSignal.timeout(DELAI_RAPIDE_MS),
    });
    if (!res.ok) return pays === "FR" ? baseAdresseNationale(q, biais) : [];
    return lireAutocomplete(await res.json());
  } catch {
    // Google injoignable ou lent : repli BAN pour ne jamais laisser le champ vide.
    return pays === "FR" ? baseAdresseNationale(q, biais) : [];
  }
}
