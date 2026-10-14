import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { peutVoirCarteTournees } from "@/lib/tours/acces-tournees";
import { chooseCommune, postalCodeFromAddress, searchCommunes } from "@/lib/geo/communes";
import { normalizeVillageName } from "@/lib/tours/carte-villages";

/** Communes distinctes cherchées par appel (la carte rappelle tant qu'il en reste). */
const MAX_LOOKUPS = 40;
const CONCURRENCY = 5;

export interface GeocodedVillage {
  id: string;
  lat: number | null;
  lng: number | null;
  inseeCode: string | null;
  geoStatus: "ok" | "introuvable";
}

type Depot = { lat: number; lng: number } | null;
const depotOf = (lat: unknown, lng: unknown): Depot => (lat != null && lng != null && lat !== "" && lng !== "" ? { lat: Number(lat), lng: Number(lng) } : null);

/**
 * Place sur la carte les villages pas encore géocodés de l'organisation
 * (geo.api.gouv.fr), et garde le résultat sur chaque village pour ne pas
 * le rechercher à nouveau. En cas d'homonymes, on préfère le code postal
 * du village, puis la commune la plus proche du dépôt du service (ou de
 * l'entreprise). Réseau indisponible : on s'arrête et on renvoie
 * `offline`, les villages restent « non localisés » et seront retentés.
 *
 * Réservé à ceux qui voient la carte (chefs d'équipe, direction) : les
 * autres rôles n'ont qu'une liste, sans carte ni coordonnées.
 */
export async function POST() {
  const appUser = await requireAppUser();
  if (!peutVoirCarteTournees(appUser.role)) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const supabase = await createServerSupabaseClient();

  const { data: rows, error } = await supabase.from("tour_route_villages").select("id, name, postal_code, tour_routes(service_id)").is("geocoded_at", null).limit(1000);
  if (error)
    return NextResponse.json(
      {
        error: "Coordonnées des villages indisponibles (mise à jour de la base en attente).",
      },
      { status: 503 },
    );
  if (!rows?.length)
    return NextResponse.json({
      results: [],
      remaining: 0,
      offline: false,
      persisted: true,
    });

  const [{ data: org }, { data: services }] = await Promise.all([
    supabase.from("organizations").select("depot_address, depot_lat, depot_lng").eq("id", appUser.organization_id).maybeSingle(),
    supabase.from("services").select("id, depot_address, depot_lat, depot_lng"),
  ]);
  const orgDepot = {
    depot: depotOf(org?.depot_lat, org?.depot_lng),
    depotPostalCode: postalCodeFromAddress(org?.depot_address),
  };
  const serviceDepots = new Map(
    (services ?? []).map((s) => {
      const depot = depotOf(s.depot_lat, s.depot_lng);
      const cp = postalCodeFromAddress(s.depot_address);
      return [
        s.id as string,
        depot || cp
          ? {
              depot: depot ?? orgDepot.depot,
              depotPostalCode: cp ?? orgDepot.depotPostalCode,
            }
          : orgDepot,
      ] as const;
    }),
  );

  // Une recherche par (commune, code postal, dépôt de référence).
  const groups = new Map<
    string,
    {
      name: string;
      postalCode: string | null;
      hint: typeof orgDepot;
      ids: string[];
    }
  >();
  for (const r of rows as any[]) {
    const serviceId: string | null = r.tour_routes?.service_id ?? null;
    const hint = (serviceId && serviceDepots.get(serviceId)) || orgDepot;
    const postalCode = (r.postal_code as string | null)?.trim() || null;
    const key = `${normalizeVillageName(r.name)}|${postalCode ?? ""}|${serviceDepots.has(serviceId ?? "") ? serviceId : ""}`;
    const g = groups.get(key) ?? {
      name: r.name as string,
      postalCode,
      hint,
      ids: [],
    };
    g.ids.push(r.id);
    groups.set(key, g);
  }
  const todo = Array.from(groups.values()).slice(0, MAX_LOOKUPS);

  let offline = false;
  const results: GeocodedVillage[] = [];
  const done: { ids: string[]; patch: Omit<GeocodedVillage, "id"> }[] = [];
  let cursor = 0;
  async function worker() {
    while (!offline && cursor < todo.length) {
      const g = todo[cursor++]!;
      const candidates = await searchCommunes(g.name, g.postalCode);
      if (candidates === null) {
        offline = true;
        return;
      }
      const match = chooseCommune(g.name, candidates, {
        postalCode: g.postalCode,
        ...g.hint,
      });
      const patch: Omit<GeocodedVillage, "id"> = match
        ? {
            lat: match.lat,
            lng: match.lng,
            inseeCode: match.inseeCode,
            geoStatus: "ok",
          }
        : { lat: null, lng: null, inseeCode: null, geoStatus: "introuvable" };
      done.push({ ids: g.ids, patch });
      for (const id of g.ids) results.push({ id, ...patch });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Les chefs d'équipe / la direction écrivent avec leurs propres droits.
  let persisted = true;
  {
    const now = new Date().toISOString();
    for (const { ids, patch } of done) {
      const { error: updateError } = await supabase
        .from("tour_route_villages")
        .update({
          lat: patch.lat,
          lng: patch.lng,
          insee_code: patch.inseeCode,
          geocode_status: patch.geoStatus,
          geocoded_at: now,
        })
        .eq("organization_id", appUser.organization_id)
        .in("id", ids);
      if (updateError) persisted = false;
    }
  }

  const processed = done.reduce((n, d) => n + d.ids.length, 0);
  return NextResponse.json({
    results,
    remaining: rows.length - processed,
    offline,
    persisted,
  });
}
