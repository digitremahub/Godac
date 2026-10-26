import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ficheClotureeDuJour, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { refusDemarrageFiche } from "@/lib/planning/ouverture-serveur";
import { assurerListeReportes, assurerListesVillages, chargerContexteRangement, listePourAdresse, listesAvecVillages, planningEtVillages, villagesDeRoute, type VillageDuJour } from "@/lib/colis/villages-serveur";
import { cochesParDefaut, elementDeArret, elementsLancement, estListeReportee, partageReports, selectionLancement } from "@/lib/colis/villages";

async function contexte(runId: string | null) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return { erreur: g.reponse };
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return { erreur: NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 }) };
  if (!runId || !z.string().uuid().safeParse(runId).success) return { erreur: NextResponse.json({ error: "Tournée invalide." }, { status: 400 }) };
  const run = await tourneeParId(supabase, appUser, runId);
  if (!run) return { erreur: NextResponse.json({ error: "Tournée introuvable." }, { status: 404 }) };
  return { appUser, supabase, run };
}

/**
 * Avant le lancement : la tournée du chauffeur d'après le planning du jour
 * (numéro, véhicule, service), ses villages (plus ceux d'un renfort du
 * jour) et les communes hors tournée de la fiche, chacun avec ses adresses
 * et colis chargés (cases à cocher), et, sans planning, les
 * tournées-modèles parmi lesquelles choisir.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ctx = await contexte(url.searchParams.get("run_id"));
  if ("erreur" in ctx) return ctx.erreur;
  const { supabase, appUser, run } = ctx;
  // Choix manuel (sans planning) : villages de la tournée-modèle choisie.
  const routeId = url.searchParams.get("route_id");
  const planningOuModele = async () => {
    // Seulement les tournées que porte cette fiche (séparée, reliée ; libre :
    // aucune). Sans la migration 20261023000002 : fiche supplémentaire =
    // tournées affectées après la fiche clôturée du jour.
    const p = await planningEtVillages(supabase, appUser.organization_id, appUser.id, run.run_date, await ficheClotureeDuJour(supabase, appUser, run), run.id);
    if (!routeId || !z.string().uuid().safeParse(routeId).success) return p;
    const { data: route } = await supabase.from("tour_routes").select("id").eq("id", routeId).eq("organization_id", appUser.organization_id).maybeSingle();
    return { passages: p.passages, villages: route ? await villagesDeRoute(supabase, route.id) : [] };
  };
  const [{ passages, villages }, { listes }, { data: stops }, { data: runPlus }] = await Promise.all([
    planningOuModele(),
    listesAvecVillages(supabase, run.id),
    supabase.from("delivery_stops").select("list_id, parcel_count, address").eq("run_id", run.id),
    supabase.from("delivery_runs").select("vehicle_id, service_id, vehicles(registration), services(name)").eq("id", run.id).maybeSingle(),
  ]);
  // Cases à cocher : villages de la tournée, communes hors tournée de la fiche
  // (une liste par commune) et adresses déjà reportées lors d'un lancement précédent.
  const elements = elementsLancement({
    villages: villages.map((v) => ({ id: v.id, nom: v.name })),
    listes: listes.map((l) => ({ id: l.id, name: l.name, hors_tournee: l.is_hors_tournee, reportee: estListeReportee(l), village_id: l.village_id })),
    arrets: (stops ?? []) as { list_id: string | null; parcel_count: number; address: string }[],
  }).map((e) => {
    const v = villages.find((x) => x.id === e.id);
    return { ...e, postal_code: v?.postal_code ?? null, tour_number: v?.tour_number ?? null, renfort: v?.renfort ?? false };
  });

  // Sans planning : tournées-modèles de ses services (sinon de l'entreprise) pour un choix manuel.
  let modeles: { id: string; tour_number: string; service_name: string | null; villages: number }[] = [];
  if (!passages.length) {
    const { data: liens } = await supabase.from("user_services").select("service_id").eq("user_id", appUser.id);
    const services = ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id);
    let q = supabase.from("tour_routes").select("id, tour_number, service_id, services(name), tour_route_villages(id)").eq("organization_id", appUser.organization_id).order("tour_number");
    if (services.length) q = q.in("service_id", services);
    const { data } = await q;
    modeles = ((data ?? []) as any[]).map((r) => ({ id: r.id, tour_number: r.tour_number, service_name: r.services?.name ?? null, villages: (r.tour_route_villages ?? []).length }));
  }

  const r = runPlus as { vehicles?: { registration?: string } | null; services?: { name?: string } | null } | null;
  return NextResponse.json({
    run: { id: run.id, name: run.name, run_date: run.run_date, vehicle: r?.vehicles?.registration ?? null, service: r?.services?.name ?? null },
    planning: passages.map((p) => ({ tour_number: p.tour_number, start_at: p.start_at, vehicle: p.vehicle, service: p.service_name, renfort: p.is_renfort })),
    elements,
    coches: cochesParDefaut(elements),
    modeles,
  });
}

/** Identifiants des cases : village (uuid), « liste:<uuid | __principale__> » ou « commune:<clé> » (adresses reportées). */
const idElement = z.string().min(1).max(120).regex(/^([0-9a-f-]{36}|liste:([0-9a-f-]{36}|__principale__)|commune:.{0,100})$/i);

const postSchema = z.object({
  run_id: z.string().uuid(),
  /** Cases cochées par le chauffeur (villages et communes hors tournée) : au moins une pour démarrer. */
  element_ids: z.array(idElement).max(400),
  /** Sans planning : tournée-modèle choisie à la main. */
  route_id: z.string().uuid().nullable().optional(),
});

/**
 * Confirmation du lancement : le chauffeur a vérifié sa tournée et coché les
 * villages (et communes hors tournée) qu'il dessert. Crée les listes
 * manquantes des villages cochés ; les adresses des cases décochées sont
 * mises de côté dans la liste « Reportés » (jamais supprimées : cochées à
 * un lancement ultérieur, elles retrouvent leur liste). Enregistre la
 * confirmation ; l'écran optimise ensuite (reportés exclus) et démarre la tournée.
 */
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const ctx = await contexte(parsed.data.run_id);
  if ("erreur" in ctx) return ctx.erreur;
  const { supabase, appUser, run } = ctx;
  if (run.status === "done") return NextResponse.json({ error: "Tournée clôturée." }, { status: 409 });
  const fermee = await refusDemarrageFiche(appUser.organization_id, run.id);
  if (fermee) return NextResponse.json({ error: fermee }, { status: 423 });

  let villages: VillageDuJour[];
  if (parsed.data.route_id) {
    const { data: route } = await supabase.from("tour_routes").select("id").eq("id", parsed.data.route_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!route) return NextResponse.json({ error: "Modèle de tournée introuvable." }, { status: 404 });
    villages = await villagesDeRoute(supabase, route.id);
  } else {
    villages = (await planningEtVillages(supabase, appUser.organization_id, appUser.id, run.run_date, await ficheClotureeDuJour(supabase, appUser, run), run.id)).villages;
  }
  const villagesNoms = villages.map((v) => ({ id: v.id, nom: v.name }));
  const { listes } = await listesAvecVillages(supabase, run.id);
  const { data: lus } = await supabase.from("delivery_stops").select("id, list_id, address, lat, lng, parcel_count").eq("run_id", run.id);
  const arrets = (lus ?? []) as { id: string; list_id: string | null; address: string; lat: number | string | null; lng: number | string | null; parcel_count: number }[];

  const elements = elementsLancement({
    villages: villagesNoms,
    listes: listes.map((l) => ({ id: l.id, name: l.name, hors_tournee: l.is_hors_tournee, reportee: estListeReportee(l), village_id: l.village_id })),
    arrets,
  });
  const choix = selectionLancement(elements, parsed.data.element_ids);
  if (!choix.ok) return NextResponse.json({ error: choix.erreur }, { status: 400 });
  const gardes = new Set(choix.gardes.map((e) => e.id));
  const villagesGardes = villages.filter((v) => gardes.has(v.id));

  let reportes = 0;
  let repris = 0;
  try {
    if (villagesGardes.length) await assurerListesVillages(supabase, appUser, run.id, villagesGardes);
    // Listes à jour (villages cochés créés) pour retrouver la liste de chaque arrêt.
    const rangement = await chargerContexteRangement(supabase, run.id);
    const { aReporter, aReprendre } = partageReports(arrets, (a) => elementDeArret(a, rangement.listes, villagesNoms), gardes);

    if (aReporter.length) {
      const liste = await assurerListeReportes(supabase, appUser, run.id, rangement);
      if (!liste) throw new Error("Impossible de mettre de côté les adresses décochées : réessayez.");
      const { error } = await supabase.from("delivery_stops").update({ list_id: liste.id }).in("id", aReporter.map((a) => a.id));
      if (error) throw new Error(`Impossible de mettre de côté les adresses décochées : ${error.message}`);
      reportes = aReporter.length;
    }
    // Adresses reportées à un lancement précédent et cochées cette fois : retour dans la liste de leur village / commune.
    const parListe = new Map<string, string[]>();
    for (const a of aReprendre) {
      const point = a.lat !== null && a.lng !== null && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng)) ? { lat: Number(a.lat), lng: Number(a.lng) } : null;
      const r = await listePourAdresse(supabase, appUser, run.id, { texte: a.address, point }, rangement);
      if (r.listId) parListe.set(r.listId, [...(parListe.get(r.listId) ?? []), a.id]);
    }
    for (const [listId, ids] of parListe) {
      const { error } = await supabase.from("delivery_stops").update({ list_id: listId }).in("id", ids);
      if (error) throw new Error(`Impossible de reprendre les adresses reportées : ${error.message}`);
      repris += ids.length;
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création des listes impossible." }, { status: 500 });
  }
  // Colonnes de la migration 190 : sans elles, le lancement reste possible.
  await supabase
    .from("delivery_runs")
    .update({ launch_confirmed_at: new Date().toISOString(), launch_village_ids: villagesGardes.map((v) => v.id), ...(parsed.data.route_id ? { route_id: parsed.data.route_id } : {}) })
    .eq("id", run.id)
    .then(() => undefined, () => undefined);
  // Des adresses ont changé de liste : l'ordre de passage est à recalculer.
  const modifie = reportes + repris > 0;
  if (modifie) await supabase.from("delivery_runs").update({ optimized_at: null }).eq("id", run.id).then(() => undefined, () => undefined);
  return NextResponse.json({ ok: true, villages: villagesGardes.length, gardes: choix.gardes.length, reportes, repris, modifie });
}
