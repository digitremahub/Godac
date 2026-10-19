import { normaliserNomRelais } from "@/lib/colis/relais";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { aujourdhuiParis, cleAdresse, creerTournee, listerTournees, moduleActif, RUN_FIELDS } from "@/lib/colis/serveur";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({ name: z.string().trim().max(60).nullable().optional() });

/** Une seule fiche Colis par chauffeur et par jour, regroupant toutes ses tournées planifiées. */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom invalide." }, { status: 400 });
  let runCreee: Awaited<ReturnType<typeof creerTournee>> | null = null;
  try {
    const dateDuJour = aujourdhuiParis();
    const { data: fichesDuJour, error: erreurFiche } = await supabase
      .from("delivery_runs")
      .select(RUN_FIELDS)
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", appUser.id)
      .eq("run_date", dateDuJour)
      .order("created_at", { ascending: false })
      .limit(50);
    if (erreurFiche) throw erreurFiche;

    // Priorité à une fiche ouverte : une ancienne fiche clôturée ne doit pas
    // masquer une fiche active créée ensuite. On conserve toutes les fiches
    // historiques sans supprimer ni écraser leurs données.
    const ficheExistante = (fichesDuJour ?? []).find((fiche: any) =>
      ["loading", "in_progress"].includes(fiche.status)
    ) ?? (fichesDuJour ?? []).find((fiche: any) => fiche.status !== "done");

    // Une fiche clôturée ne doit jamais être recréée ni modifiée par un second clic.
    if (!ficheExistante && (fichesDuJour ?? []).some((fiche: any) => fiche.status === "done")) {
      const ficheCloturee = (fichesDuJour ?? []).find((fiche: any) => fiche.status === "done");
      return NextResponse.json({ run: ficheCloturee, reused: true });
    }

    let run: NonNullable<typeof ficheExistante> | Awaited<ReturnType<typeof creerTournee>> | undefined = ficheExistante;
    if (!run) {
      try {
        run = await creerTournee(supabase, appUser, parsed.data.name ?? null);
      } catch (e) {
        // Double clic : l'index unique « une fiche ouverte par chauffeur et
        // par jour » (migration 20261019000006, audit M3) refuse la seconde ;
        // on reprend la fiche créée par la première requête.
        const doublon = (e as { code?: string })?.code === "23505" || /duplicate key|delivery_runs_driver_open_day_uidx/i.test(e instanceof Error ? e.message : "");
        if (!doublon) throw e;
        const { data: concurrente, error: erreurConcurrente } = await supabase
          .from("delivery_runs")
          .select(RUN_FIELDS)
          .eq("organization_id", appUser.organization_id)
          .eq("driver_id", appUser.id)
          .eq("run_date", dateDuJour)
          .neq("status", "done")
          .limit(1)
          .maybeSingle();
        if (erreurConcurrente || !concurrente) throw e;
        return NextResponse.json({ run: concurrente, reused: true });
      }
    }
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
      const premiere = passages[0]!;
      const plannedStart = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).format(new Date(premiere.start_at));
      const numeros = [...new Set(passages.map((p: any) => String(p.tour_number)))];
      const nomFiche = numeros.length === 1
        ? `Tournée n°${numeros[0]}`
        : (numeros.length <= 4 ? `Tournées n°${numeros.join(", ")}` : "Tournées du jour");
      const { error: runUpdateError } = await supabase.from("delivery_runs")
        .update({
          name: nomFiche.slice(0, 60),
          planned_start: plannedStart,
          ...(premiere.service_id ? { service_id: premiere.service_id } : {}),
        })
        .eq("id", run.id);
      if (runUpdateError) throw runUpdateError;

      const pays = await codePays(appUser.organization_id);
      const { data: listesExistantes, error: erreurListesExistantes } = await supabase
        .from("delivery_lists")
        .select("id, name, position")
        .eq("run_id", run.id)
        .order("position");
      if (erreurListesExistantes) throw erreurListesExistantes;
      const listesParVillage = new Map<string, { id: string; position: number }>();
      for (const listeExistante of listesExistantes ?? []) {
        listesParVillage.set(cleAdresse(listeExistante.name), {
          id: listeExistante.id,
          position: listeExistante.position,
        });
      }
      const { data: arretsExistants, error: erreurArretsExistants } = await supabase
        .from("delivery_stops")
        .select("kind, address, position")
        .eq("run_id", run.id);
      if (erreurArretsExistants) throw erreurArretsExistants;
      const arretsAjoutes = new Set(
        (arretsExistants ?? []).map((stop: any) => `${stop.kind}:${cleAdresse(stop.address)}`)
      );
      let positionListe = Math.max(-1, ...(listesExistantes ?? []).map((l: any) => l.position ?? -1)) + 1;
      let positionArret = Math.max(-1, ...(arretsExistants ?? []).map((s: any) => s.position ?? -1)) + 1;

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
              // Point relais : le nom saisi sur la fiche du village devient le nom du relais.
              relayName: s.type === "point_relais" ? normaliserNomRelais(typeof s.name === "string" ? s.name : null) : null,
            }));
          const pickups = (Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [])
            .filter((a: unknown): a is string => typeof a === "string")
            .map((address: string) => ({ address: address.trim(), kind: "ramasse", relayName: null as string | null }));
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
              ...(stop.relayName ? { relay_name: stop.relayName } : {}),
              address,
              // Les ramasses et points relais comptent comme des arrêts uniquement.
              // Le nombre de colis réels sera renseigné lors du traitement de l'arrêt.
              parcel_count: 0,
              status: "pending",
              lat: geo?.lat ?? null,
              lng: geo?.lng ?? null,
            });
            if (erreurArret) throw new Error(`Impossible d’ajouter l’arrêt « ${address} » : ${erreurArret.message}`);
          }
        }
      }
    }

    // Retourner la version persistée : le nom et les métadonnées viennent
    // d'être mis à jour pendant la fusion des tournées planifiées.
    const { data: runActualise, error: erreurRunActualise } = await supabase
      .from("delivery_runs")
      .select(RUN_FIELDS)
      .eq("id", run.id)
      .maybeSingle();
    if (erreurRunActualise) throw erreurRunActualise;

    return NextResponse.json({ run: runActualise ?? run, reused: Boolean(ficheExistante) });
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
