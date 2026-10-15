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
  try {
    const run = await creerTournee(supabase, appUser, parsed.data.name ?? null);
    const pays = await codePays(appUser.organization_id);
    let position = 0;
    const adressesAjoutees = new Set<string>();

    // 1) Ramasses saisies par la Direction dans la fiche de chaque village.
    // On récupère la tournée affectée à ce chauffeur pour la date de la tournée colis.
    const date = run.run_date;
    const veille = new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString();
    const lendemain = new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString();
    const { data: planning, error: erreurPlanning } = await supabase
      .from("planning_entries")
      .select("tour_number, service_id, start_at")
      .eq("organization_id", appUser.organization_id)
      .eq("driver_id", appUser.id)
      .gte("start_at", veille)
      .lt("start_at", lendemain)
      .order("start_at");
    if (erreurPlanning) throw erreurPlanning;
    const passage = (planning ?? []).find((entry: any) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(entry.start_at)) === date
      && entry.tour_number
      && (!run.service_id || !entry.service_id || entry.service_id === run.service_id)
    );

    if (passage?.tour_number) {
      const { data: route, error: erreurRoute } = await supabase
        .from("tour_routes")
        .select("id")
        .eq("organization_id", appUser.organization_id)
        .eq("tour_number", passage.tour_number)
        .maybeSingle();
      if (erreurRoute) throw erreurRoute;
      if (route) {
        const { data: villages, error: erreurVillages } = await supabase
          .from("tour_route_villages")
          .select("id, name, pickup_addresses, position")
          .eq("route_id", route.id)
          .order("position");
        if (erreurVillages) throw erreurVillages;
        for (const village of villages ?? []) {
          const adresses = Array.isArray(village.pickup_addresses) ? village.pickup_addresses : [];
          const adressesUniques = adresses.map((a: string) => a.trim()).filter((a: string) => a.length >= 5 && !adressesAjoutees.has(cleAdresse(a)));
          if (!adressesUniques.length) continue;
          const { data: liste, error: erreurListe } = await supabase
            .from("delivery_lists")
            .insert({ organization_id: appUser.organization_id, run_id: run.id, name: village.name.slice(0, 60), position })
            .select("id")
            .single();
          if (erreurListe) throw new Error(`Tournée créée, mais la liste du village « ${village.name} » n’a pas pu être créée : ${erreurListe.message}`);
          position += 1;
          for (const address of adressesUniques) {
            const geo = await geocodeAddress(address, pays).catch(() => null);
            const { error } = await supabase.from("delivery_stops").insert({
              organization_id: appUser.organization_id,
              run_id: run.id,
              list_id: liste.id,
              position,
              kind: "ramasse",
              address,
              parcel_count: 1,
              status: "pending",
              lat: geo?.lat ?? null,
              lng: geo?.lng ?? null,
            });
            if (error) throw new Error(`Tournée créée, mais la ramasse « ${address} » n’a pas pu être ajoutée : ${error.message}`);
            adressesAjoutees.add(cleAdresse(address));
            position += 1;
          }
        }
      }
    }

    // 2) Ramasses habituelles du chauffeur, en complément des ramasses de village.
    const { data: habitudes, error: erreurHabitudes } = await supabase
      .from("driver_pickup_templates")
      .select("address, recipient, phone")
      .eq("driver_id", appUser.id)
      .eq("organization_id", appUser.organization_id)
      .eq("active", true)
      .order("created_at");
    if (erreurHabitudes && erreurHabitudes.code !== "42P01") throw erreurHabitudes;
    for (const habitude of habitudes ?? []) {
      if (adressesAjoutees.has(cleAdresse(habitude.address))) continue;
      const geo = await geocodeAddress(habitude.address, pays).catch(() => null);
      const { error } = await supabase.from("delivery_stops").insert({
        organization_id: appUser.organization_id,
        run_id: run.id,
        position,
        kind: "ramasse",
        address: habitude.address,
        recipient: habitude.recipient,
        phone: habitude.phone,
        parcel_count: 1,
        status: "pending",
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
      });
      if (error) throw new Error(`Tournée créée, mais une ramasse habituelle n’a pas pu être ajoutée : ${error.message}`);
      adressesAjoutees.add(cleAdresse(habitude.address));
      position += 1;
    }
    return NextResponse.json({ run });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}
