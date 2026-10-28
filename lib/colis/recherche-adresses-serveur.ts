// Sources réseau de la recherche d'adresses et d'établissements (annuaire
// interne, OpenStreetMap/Photon, Base Adresse Nationale, Google Places, et
// « Recherche d'entreprises » (SIRENE) pour les professionnels par leur nom).
// Partagées par /api/colis/adresses/recherche et /api/tour-routes/etablissements.
import type { garderApi } from "@/lib/acces/garde-api";
import { depuisPhoton, filtrerAnnuaire, type EntreeAnnuaire, type ProprietesPhoton, type SuggestionAdresse } from "@/lib/colis/recherche-adresses";
import { departementDepuisReverse, lireEntreprises, preparerRequete, urlRecherche } from "@/lib/colis/recherche-entreprises";
import { corpsAutocomplete, lireAutocomplete, MASQUE_AUTOCOMPLETE, URL_AUTOCOMPLETE } from "@/lib/colis/places-google";

const UA = "GODAC/1.0 (recherche d'adresses et d'établissements ; https://godac-v2.vercel.app)";
/** Au-delà, une source facultative est abandonnée : elle ne doit jamais retarder la saisie. */
export const DELAI_RAPIDE_MS = 1200;
export const DELAI_ANNUAIRE_MS = 700;
export const DELAI_COMPLEMENT_MS = 1500;
/** SIRENE dans la réponse rapide : assez court pour ne jamais retarder la BAN de façon perceptible. */
export const DELAI_PRO_MS = 900;

/** Résultat de repli si la source dépasse le délai (sans l'annuler : elle se termine seule). */
export function delai(p: Promise<SuggestionAdresse[]>, ms: number): Promise<SuggestionAdresse[]> {
  return Promise.race([p, new Promise<SuggestionAdresse[]>((r) => setTimeout(() => r([]), ms))]);
}

type Client = Awaited<ReturnType<typeof garderApi>> extends infer R ? (R extends { ok: true; supabase: infer S } ? S : never) : never;

/** Annuaire de l'entreprise : fiches horaires nommées et noms d'établissements des arrêts passés. */
export async function annuaireInterne(supabase: Client, organizationId: string, q: string): Promise<SuggestionAdresse[]> {
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

export async function photon(q: string, biais: { lat: number; lng: number } | null, pays: string): Promise<SuggestionAdresse[]> {
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

export async function baseAdresseNationale(q: string, biais: { lat: number; lng: number } | null): Promise<SuggestionAdresse[]> {
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
export async function googlePlaces(cle: string, q: string, biais: { lat: number; lng: number } | null, pays: string, session: string | null): Promise<SuggestionAdresse[]> {
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

/** Département (« 17 ») du point, par géocodage inverse BAN : sert à restreindre la recherche d'entreprises. */
async function departementDuBiais(biais: { lat: number; lng: number }, signal: AbortSignal): Promise<string | null> {
  try {
    // Coordonnées arrondies : les frappes successives partagent la même réponse en cache.
    const p = new URLSearchParams({ lat: biais.lat.toFixed(2), lon: biais.lng.toFixed(2) });
    const res = await fetch(`https://api-adresse.data.gouv.fr/reverse/?${p.toString()}`, { headers: { Accept: "application/json" }, signal, next: { revalidate: 60 } });
    return res.ok ? departementDepuisReverse(await res.json()) : null;
  } catch {
    return null;
  }
}

/**
 * Professionnels par leur nom : API publique « Recherche d'entreprises »
 * (répertoire SIRENE, gratuite, sans clé, ≤ 7 requêtes/s). France seulement ;
 * ne cherche que si le texte ressemble à un nom. Filtre par code postal du
 * texte, sinon par département du biais GPS (puis, si rien, sans filtre).
 * Repli silencieux ([]) sur toute erreur ou dépassement de DELAI_COMPLEMENT_MS ;
 * rien n'est stocké (cache de requête de 60 s seulement).
 */
export async function entreprises(q: string, biais: { lat: number; lng: number } | null): Promise<SuggestionAdresse[]> {
  try {
    const requete = preparerRequete(q);
    if (!requete) return [];
    const signal = AbortSignal.timeout(DELAI_COMPLEMENT_MS);
    const departement = !requete.codePostal && biais ? await departementDuBiais(biais, signal) : null;
    const appeler = async (dep: string | null) => {
      const res = await fetch(urlRecherche(requete, dep), { headers: { Accept: "application/json", "User-Agent": UA }, signal, next: { revalidate: 60 } });
      return res.ok ? lireEntreprises(await res.json()) : [];
    };
    const filtre = Boolean(requete.codePostal || departement);
    const trouves = await appeler(departement);
    // Filtre trop strict (commune voisine, chaîne nationale) : on retente sans.
    return trouves.length === 0 && filtre && !requete.codePostal ? await appeler(null) : trouves;
  } catch {
    return [];
  }
}
