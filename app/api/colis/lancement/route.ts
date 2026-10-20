import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { estFicheSupplementaire, moduleActif, tourneeParId } from "@/lib/colis/serveur";
import { assurerListesVillages, listesAvecVillages, planningEtVillages, villagesDeRoute, type VillageDuJour } from "@/lib/colis/villages-serveur";

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
 * jour) avec les colis chargés pour chacun, et, sans planning, les
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
    // Fiche supplémentaire : le planning du jour est déjà fait sur la fiche clôturée.
    const p = (await estFicheSupplementaire(supabase, appUser, run))
      ? { passages: [], villages: [] as VillageDuJour[] }
      : await planningEtVillages(supabase, appUser.organization_id, appUser.id, run.run_date);
    if (!routeId || !z.string().uuid().safeParse(routeId).success) return p;
    const { data: route } = await supabase.from("tour_routes").select("id").eq("id", routeId).eq("organization_id", appUser.organization_id).maybeSingle();
    return { passages: p.passages, villages: route ? await villagesDeRoute(supabase, route.id) : [] };
  };
  const [{ passages, villages }, { listes }, { data: stops }, { data: runPlus }] = await Promise.all([
    planningOuModele(),
    listesAvecVillages(supabase, run.id),
    supabase.from("delivery_stops").select("list_id, parcel_count, status").eq("run_id", run.id),
    supabase.from("delivery_runs").select("vehicle_id, service_id, vehicles(registration), services(name)").eq("id", run.id).maybeSingle(),
  ]);
  const compte = new Map<string | null, { arrets: number; colis: number }>();
  for (const s of (stops ?? []) as { list_id: string | null; parcel_count: number }[]) {
    const c = compte.get(s.list_id) ?? { arrets: 0, colis: 0 };
    c.arrets++;
    c.colis += s.parcel_count ?? 0;
    compte.set(s.list_id, c);
  }
  const avecListe = (v: VillageDuJour) => {
    const l = listes.find((x) => x.village_id === v.id);
    return { id: v.id, name: v.name, postal_code: v.postal_code ?? null, tour_number: v.tour_number, renfort: v.renfort, liste_id: l?.id ?? null, ...(compte.get(l?.id ?? "") ?? { arrets: 0, colis: 0 }) };
  };
  const rattachees = new Set(villages.map((v) => listes.find((l) => l.village_id === v.id)?.id).filter(Boolean));
  const autres = listes
    .filter((l) => !rattachees.has(l.id) && (compte.get(l.id)?.arrets ?? 0) > 0)
    .map((l) => ({ id: l.id, name: l.name, hors_tournee: l.is_hors_tournee, ...compte.get(l.id)! }));
  if (compte.get(null)?.arrets) autres.unshift({ id: "__principale__", name: "Liste principale", hors_tournee: false, ...compte.get(null)! });

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
    villages: villages.map(avecListe),
    autres,
    modeles,
  });
}

const postSchema = z.object({
  run_id: z.string().uuid(),
  /** Villages cochés par le chauffeur : tous ceux de sa tournée doivent l'être. */
  village_ids: z.array(z.string().uuid()).max(200),
  /** Sans planning : tournée-modèle choisie à la main. */
  route_id: z.string().uuid().nullable().optional(),
});

/**
 * Confirmation du lancement : le chauffeur a vérifié sa tournée et coché
 * tous ses villages. Crée les listes manquantes (une par village) et
 * enregistre la confirmation ; l'écran optimise puis démarre la tournée.
 */
export async function POST(req: Request) {
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  const ctx = await contexte(parsed.data.run_id);
  if ("erreur" in ctx) return ctx.erreur;
  const { supabase, appUser, run } = ctx;
  if (run.status === "done") return NextResponse.json({ error: "Tournée clôturée." }, { status: 409 });

  let villages: VillageDuJour[];
  if (parsed.data.route_id) {
    const { data: route } = await supabase.from("tour_routes").select("id").eq("id", parsed.data.route_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!route) return NextResponse.json({ error: "Tournée-modèle introuvable." }, { status: 404 });
    villages = await villagesDeRoute(supabase, route.id);
  } else if (await estFicheSupplementaire(supabase, appUser, run)) {
    villages = [];
  } else {
    villages = (await planningEtVillages(supabase, appUser.organization_id, appUser.id, run.run_date)).villages;
  }
  const coches = new Set(parsed.data.village_ids);
  const manquants = villages.filter((v) => !coches.has(v.id));
  if (manquants.length) {
    return NextResponse.json({ error: `Cochez chaque village pour confirmer que vous le prenez : ${manquants.map((v) => v.name).join(", ")}.` }, { status: 400 });
  }
  try {
    if (villages.length) await assurerListesVillages(supabase, appUser, run.id, villages);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création des listes impossible." }, { status: 500 });
  }
  // Colonnes de la migration 190 : sans elles, le lancement reste possible.
  await supabase
    .from("delivery_runs")
    .update({ launch_confirmed_at: new Date().toISOString(), launch_village_ids: villages.map((v) => v.id), ...(parsed.data.route_id ? { route_id: parsed.data.route_id } : {}) })
    .eq("id", run.id)
    .then(() => undefined, () => undefined);
  return NextResponse.json({ ok: true, villages: villages.length });
}
