import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Point } from "@/lib/colis/optimisation";
import type { Semaine } from "@/lib/colis/horaires";
import { convertirPeriodesGoogle, parserOpeningHours, type PeriodeGoogle } from "@/lib/colis/opening-hours";
import { choisirCommerce, detecterProfessionnel } from "@/lib/colis/professionnel";
import { communeDepuisAdresse } from "@/lib/colis/villages";
import { cleAdresse } from "@/lib/colis/serveur";

/**
 * Horaires d'ouverture des adresses professionnelles cherchés sur internet,
 * puis enregistrés dans l'annuaire de l'entreprise (delivery_address_hours)
 * pour l'optimisation.
 *
 * Sources, par ordre :
 * 1. OpenStreetMap, gratuit et sans clé : lieux nommés à moins de 40 m de
 *    l'adresse (Overpass, une requête pour tout un lot d'arrêts), balise
 *    opening_hours ; à défaut, recherche du nom dans la commune (Nominatim,
 *    une requête par seconde au plus).
 * 2. Google Places (API « Places (New) », Text Search), seulement si une clé
 *    GOOGLE_PLACES_API_KEY (ou GOOGLE_MAPS_API_KEY) est configurée — payant
 *    au-delà du quota gratuit de Google.
 *
 * Une fiche saisie à la main (source « manuel ») n'est jamais écrasée.
 * Tous les appels ont un délai court et ne lèvent jamais.
 */

const OVERPASS = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const NOMINATIM = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
const UA = "GODAC/1.0 (https://godac.app; contact@godac.fr)";
const RAYON_M = 40;

export type SourceHoraires = "openstreetmap" | "google";

export interface Commerce {
  nom: string;
  distanceM: number;
  openingHours: string | null;
  ref: string;
}

export interface HorairesTrouves {
  nom: string;
  semaine: Semaine;
  source: SourceHoraires;
  ref: string;
}

function distanceMetres(a: Point, b: Point): number {
  const rad = (n: number) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type ElementOSM = { type?: string; id?: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> };

/** Lieux nommés (commerces, bureaux, services…) autour de chaque point, en une requête Overpass. Clé : identifiant fourni. */
export async function commercesProches(points: { id: string; point: Point }[]): Promise<Map<string, Commerce[]>> {
  const out = new Map<string, Commerce[]>();
  const lot = points.filter((p) => Number.isFinite(p.point.lat) && Number.isFinite(p.point.lng)).slice(0, 40);
  if (!lot.length) return out;
  const blocs = lot.map((p) => `nwr(around:${RAYON_M},${p.point.lat},${p.point.lng})["name"][~"^(shop|office|amenity|craft|healthcare|tourism|leisure)$"~"."];`).join("\n");
  try {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
      body: new URLSearchParams({ data: `[out:json][timeout:12];(${blocs});out center tags;` }),
      cache: "no-store",
      signal: AbortSignal.timeout(14000),
    });
    if (!res.ok) return out;
    const elements = (((await res.json()) as { elements?: ElementOSM[] }).elements ?? []).filter((e) => e.tags?.name);
    for (const p of lot) {
      const proches: Commerce[] = [];
      for (const e of elements) {
        const lat = e.lat ?? e.center?.lat;
        const lng = e.lon ?? e.center?.lon;
        if (lat === undefined || lng === undefined) continue;
        const d = distanceMetres(p.point, { lat, lng });
        if (d <= RAYON_M) proches.push({ nom: e.tags!.name!, distanceM: Math.round(d), openingHours: e.tags?.opening_hours ?? null, ref: `osm:${e.type}/${e.id}` });
      }
      out.set(p.id, proches.sort((a, b) => a.distanceM - b.distanceM));
    }
  } catch {
    // Overpass indisponible : on réessaiera à la prochaine optimisation.
  }
  return out;
}

/** Nom d'entreprise cherché dans sa commune (Nominatim), avec la balise opening_hours. */
async function horairesNominatim(nom: string, commune: string | null, pays = "fr"): Promise<HorairesTrouves | null> {
  if (!commune) return null;
  try {
    const q = new URLSearchParams({ q: `${nom}, ${commune}`, format: "jsonv2", limit: "3", extratags: "1", countrycodes: pays });
    const res = await fetch(`${NOMINATIM}/search?${q}`, { headers: { "User-Agent": UA, "Accept-Language": "fr" }, signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) return null;
    const hits = (await res.json()) as { name?: string; osm_type?: string; osm_id?: number; extratags?: Record<string, string> }[];
    for (const h of hits) {
      const semaine = parserOpeningHours(h.extratags?.opening_hours);
      if (semaine) return { nom: h.name || nom, semaine, source: "openstreetmap", ref: `osm:${h.osm_type}/${h.osm_id}` };
    }
  } catch {
    /* service indisponible */
  }
  return null;
}

/** Google Places (facultatif, clé requise). */
async function horairesGoogle(nom: string, adresse: string): Promise<HorairesTrouves | null> {
  const cle = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!cle) return null;
  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": cle, "X-Goog-FieldMask": "places.id,places.displayName,places.regularOpeningHours" },
      body: JSON.stringify({ textQuery: `${nom}, ${adresse}`, languageCode: "fr", maxResultCount: 1 }),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const p = (((await res.json()) as { places?: { id?: string; displayName?: { text?: string }; regularOpeningHours?: { periods?: PeriodeGoogle[] } }[] }).places ?? [])[0];
    const semaine = convertirPeriodesGoogle(p?.regularOpeningHours?.periods);
    return p && semaine ? { nom: p.displayName?.text || nom, semaine, source: "google", ref: `google:${p.id}` } : null;
  } catch {
    return null;
  }
}

export interface ArretRecherche {
  id: string;
  address: string;
  recipient: string | null;
  lat: number | string | null;
  lng: number | string | null;
  kind?: string | null;
  business_name?: string | null;
}

export interface ResultatRecherche {
  stopId: string;
  pro: boolean;
  nom: string | null;
  horaires: { source: SourceHoraires; nom: string } | null;
}

/**
 * Pour chaque arrêt : professionnel ? (forme juridique, mot-clé, commerce à
 * l'adresse) ; si oui et que l'annuaire n'a pas encore de fiche pour cette
 * adresse, cherche les horaires et les enregistre (source + référence).
 * Marque les arrêts comme cherchés (hours_lookup_at) pour ne pas refaire
 * la recherche. `budgetMs` borne la durée totale.
 */
export async function rechercherEtEnregistrerHoraires(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  arrets: ArretRecherche[],
  options: { budgetMs?: number; pays?: string } = {},
): Promise<ResultatRecherche[]> {
  const t0 = Date.now();
  const budget = options.budgetMs ?? 20000;
  const lot = arrets.slice(0, 40);
  if (!lot.length) return [];

  const cles = [...new Set(lot.map((s) => cleAdresse(s.address)))];
  const { data: fiches } = await supabase.from("delivery_address_hours").select("address_key, weekly_schedule").eq("organization_id", organizationId).in("address_key", cles);
  // Une fiche client sans horaires (créée à la clôture d'un arrêt, migration 20261113000001) n'empêche pas la recherche des horaires.
  const existantes = (fiches ?? []) as { address_key: string; weekly_schedule: unknown }[];
  const avecHoraires = (f: { weekly_schedule: unknown }) => Boolean(f.weekly_schedule && typeof f.weekly_schedule === "object" && Object.keys(f.weekly_schedule as object).length);
  const connues = new Set(existantes.filter(avecHoraires).map((f) => f.address_key));
  const sansHoraires = new Set(existantes.filter((f) => !avecHoraires(f)).map((f) => f.address_key));

  const localises = lot.filter((s) => s.lat !== null && s.lng !== null && !connues.has(cleAdresse(s.address)));
  const commerces = await commercesProches(localises.map((s) => ({ id: s.id, point: { lat: Number(s.lat), lng: Number(s.lng) } })));

  const resultats: ResultatRecherche[] = [];
  let nominatimDernier = 0;
  for (const s of lot) {
    const proches = commerces.get(s.id) ?? [];
    const relaisOuRamasse = s.kind === "point_relais" || s.kind === "ramasse";
    const detection = detecterProfessionnel({ destinataire: s.business_name || s.recipient, adresse: s.address, commerces: proches });
    const pro = detection.pro || relaisOuRamasse;
    const nom = detection.nom ?? s.business_name ?? (relaisOuRamasse ? s.recipient : null);
    let trouve: HorairesTrouves | null = null;
    if (pro && !connues.has(cleAdresse(s.address)) && Date.now() - t0 < budget) {
      const commerce = choisirCommerce(detection, proches, s.business_name || s.recipient);
      const semaine = parserOpeningHours(commerce?.openingHours);
      if (commerce && semaine) trouve = { nom: commerce.nom, semaine, source: "openstreetmap", ref: commerce.ref };
      if (!trouve && nom) {
        // Nominatim : une requête par seconde au plus (conditions d'utilisation).
        const attente = 1000 - (Date.now() - nominatimDernier);
        if (attente > 0) await new Promise((r) => setTimeout(r, attente));
        nominatimDernier = Date.now();
        trouve = await horairesNominatim(nom, communeDepuisAdresse(s.address).commune, options.pays?.toLowerCase() ?? "fr");
      }
      if (!trouve && nom) trouve = await horairesGoogle(nom, s.address);
      if (trouve) {
        const horaires = {
          label: trouve.nom.slice(0, 120),
          weekly_schedule: trouve.semaine,
          source: trouve.source,
          source_ref: trouve.ref.slice(0, 300),
          found_at: new Date().toISOString(),
          updated_by: userId,
        };
        // Fiche client déjà là (sans horaires) : on y ajoute les horaires, sans toucher au reste ; sinon nouvelle fiche.
        const { error } = sansHoraires.has(cleAdresse(s.address))
          ? await supabase.from("delivery_address_hours").update(horaires).eq("organization_id", organizationId).eq("address_key", cleAdresse(s.address))
          : await supabase.from("delivery_address_hours").insert({ organization_id: organizationId, address_key: cleAdresse(s.address), address: s.address, notes: null, ...horaires });
        // Conflit (fiche créée entre-temps) ou migration absente : on ne remplace rien.
        if (error) trouve = null;
        else connues.add(cleAdresse(s.address));
      }
    }
    resultats.push({ stopId: s.id, pro, nom, horaires: trouve ? { source: trouve.source, nom: trouve.nom } : null });
  }

  const ids = lot.map((s) => s.id);
  await supabase.from("delivery_stops").update({ hours_lookup_at: new Date().toISOString() }).in("id", ids).then(() => undefined, () => undefined);
  for (const r of resultats.filter((x) => x.pro && x.nom)) {
    const s = lot.find((x) => x.id === r.stopId);
    if (s && !s.business_name) await supabase.from("delivery_stops").update({ business_name: r.nom!.slice(0, 200) }).eq("id", r.stopId).then(() => undefined, () => undefined);
  }
  return resultats;
}
