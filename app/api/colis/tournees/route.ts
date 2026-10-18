import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { cleAdresse, creerTournee, listerTournees, moduleActif } from "@/lib/colis/serveur";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({ name: z.string().trim().max(60).nullable().optional() });

/** Nouvelle tournée colis du jour (on peut en faire plusieurs). */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom invalide." }, { status: 400 });
  let runCreee: Awaited<ReturnType<typeof creerTournee>> | null = null;
  try {
    const run = await creerTournee(supabase, appUser, parsed.data.name ?? null);
    runCreee = run;
    const pays = await codePays(appUser.organization_id);
    // Au clic du chauffeur, charger toutes les tournées qui lui sont planifiées
    // pour cette date dans UNE seule fiche Tournée colis.
    const date = run.run_date;
    const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
    const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
    const { data: planning, error: erreurPlanning } = await supabase
      .from("planning_entries")
      .select("id, tour_number, service_id, start_at, status")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", appUser.id)
      .in("status", ["planned", "in_progress"])
      .gte("start_at", veille)
      .lt("start_at", lendemain)
      .order("start_at");
    if (erreurPlanning) throw erreurPlanning;

    const jourParis = (value: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(value));
    const passages = (planning ?? []).filter((entry: any) =>
      jourParis(entry.start_at) === date && Boolean(entry.tour_number)
    );
    if (passages.length) {
      // La première affectation fournit l'heure et le service par défaut.
      const premiere = passages[0];
      if (!premiere) {
        throw new Error("Aucune affectation de tournée exploitable pour cette date.");
      }
      const plannedStart = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(new Date(premiere.start_at));
      const { error: runUpdateError } = await supabase.from("delivery_runs")
        .update({ planned_start: plannedStart, ...(premiere.service_id ? { service_id: premiere.service_id } : {}) })
        .eq("id", run.id);
      if (runUpdateError) throw runUpdateError;

      const pays = await codePays(appUser.organization_id);
      const listesParVillage = new Map<string, { id: string; position: number }>();
      const arretsAjoutes = new Set<string>();
      let positionListe = 0;
      let positionArret = 0;

      for (const passage of passages) {
        let routeQuery = supabase.from("tour_routes")
          .select("id, tour_number, service_id")
          .eq("organization_id", appUser.organization_id)
          .eq("tour_number", passage.tour_number);
        if (passage.service_id) routeQuery = routeQuery.eq("service_id", passage.service_id);
        const { data: routes, error: erreurRoute } = await routeQuery;
        if (erreurRoute) throw erreurRoute;
        const route = (routes ?? [])[0];
        if (!route) {
          console.warn("[colis/tournees] Modèle de tournée introuvable", { tourNumber: passage.tour_number, serviceId: passage.service_id });
          continue;
        }

        const { data: villages, error: erreurVillages } = await supabase
          .from("tour_route_villages")
          .select("id, name, pickup_addresses, planned_stops, position")
          .eq("route_id", route.id)
          .order("position");
        if (erreurVillages) throw erreurVillages;

        for (const village of villages ?? []) {
          const villageKey = cleAdresse(village.name);
          let liste = listesParVillage.get(villageKey);
          if (!liste) {
            const { data: creee, error: erreurListe } = await supabase.from("delivery_lists").insert({
              organization_id: appUser.organization_id,
              run_id: run.id,
              name: village.name.slice(0, 60),
              position: positionListe++,
            }).select("id").single();
            if (erreurListe) throw new Error(`Impossible de créer la liste du village « ${village.name} » : ${erreurListe.message}`);
            liste = { id: creee.id, position: positionListe - 1 };
            listesParVillage.set(villageKey, liste);
          }

          // planned_stops distingue les ramasses et points relais. pickup_addresses
          // est conservé comme compatibilité pour les anciennes fiches de tournée.
          const planned = Array.isArray(village.planned_stops) ? village.planned_stops : [];
          const plannedStops = planned
            .filter((s: any) => s && typeof s.address === "string")
            .map((s: any) => ({
              address: s.address.trim(),
              kind: s.type === "point_relais" ? "point_relais" : "ramasse",
            }));
          const pickups = (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])
            .filter((a: unknown): a is string => typeof a === "string")
            .map((address: string) => ({ address: address.trim(), kind: "ramasse" }));
          const allStops = [...plannedStops, ...pickups];

          for (const stop of allStops) {
            const address = stop.address;
            if (address.length < 5) continue;
            const stopKey = `${stop.kind}:${cleAdresse(address)}`;
            if (arretsAjoutes.has(stopKey)) continue;
            arretsAjoutes.add(stopKey);
            const geo = await geocodeAddress(address, pays).catch(() => null);
            const { error: erreurArret } = await supabase.from("delivery_stops").insert({
              organization_id: appUser.organization_id,
              run_id: run.id,
              list_id: liste.id,
              position: positionArret++,
              kind: stop.kind,
              address,
              parcel_count: 1,
              status: "pending",
              lat: geo?.lat ?? null,
              lng: geo?.lng ?? null,
            });
            if (erreurArret) throw new Error(`Impossible d’ajouter l’arrêt « ${address} » : ${erreurArret.message}`);
          }
        }
      }
    }

    return NextResponse.json({ run });
  } catch (e) {
    // La tournée est créée avant l'ajout facultatif des ramasses. Une erreur
    // sur le planning, les migrations ou une ramasse ne doit pas faire croire
    // que la création de la tournée elle-même a échoué (ni provoquer un doublon
    // lorsque le chauffeur réessaie). On renvoie la tournée créée et on journalise
    // l'échec des compléments pour faciliter le diagnostic serveur.
    if (runCreee) {
      console.error("[colis/tournees] Tournée créée, mais ajout des ramasses incomplet", {
        runId: runCreee.id,
        error: e instanceof Error ? e.message : e,
      });
      return NextResponse.json({
        run: runCreee,
        warning: "Tournée créée, mais certaines ramasses n’ont pas pu être ajoutées. Vérifiez les migrations Supabase et le planning.",
      });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}
