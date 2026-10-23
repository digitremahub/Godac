import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { decisionsAffectation } from "@/lib/planning/affectation";
import { absentSelon, lireAbsences } from "@/lib/planning/absences";
import { libererFicheAncienChauffeur } from "@/lib/planning/fiche-reaffectation";
import { warnIfDriverDoubleBooked } from "@/lib/planning/conflict-alert";
import { ficheApresAffectation, ficheAPreparer, questionAvantAffectation } from "@/lib/colis/fiche-a-l-affectation";
import { FILTRE_CONDUCTEURS } from "@/lib/roles/conducteurs";
import type { AffectationPlanning } from "@/lib/planning/semaine";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  tour_number: z.string().trim().min(1).max(60),
  driver_id: z.string().uuid(),
  /** Jours de Paris : une case (vue Jour, case de la semaine), une semaine, des jours étirés. */
  dates: z.array(z.string().date()).min(1).max(62),
  /** Heure de départ de Paris des affectations créées (celles qui existent gardent la leur, sauf `imposer_heure`). */
  heure: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  /** Heure choisie à la main dans la feuille « Affecter à… » : les affectations existantes d'une autre heure la prennent aussi. */
  imposer_heure: z.boolean().optional(),
  /** Véhicule des affectations créées ou sans véhicule ; défaut : véhicule attribué au chauffeur. */
  vehicle_id: z.string().uuid().nullable().optional(),
  /** Réponse à la question « séparées ou reliées » (409 choix_requis). */
  regroupement: z.enum(["separee", "reliee"]).optional(),
});

const CHAMPS = "id, service_id, tour_number, driver_id, vehicle_id, start_at, status, created_at";

/**
 * Placer un chauffeur sur une tournée, un ou plusieurs jours : c'est ce que
 * fait le glisser-déposer du planning (components/planning/Affectations.tsx).
 * Pour chaque jour (lib/planning/affectation.ts › decisionsAffectation) :
 * - case vide : affectation créée (heure de la tournée, véhicule) ;
 * - affectation prévue sans chauffeur ou avec un autre : ce chauffeur la
 *   prend (l'ancien chauffeur perd sa fiche colis, il est prévenu à la
 *   publication) ;
 * - tournée déjà démarrée : rien ;
 * - chauffeur en congé validé ou en arrêt ce jour-là : il n'est PAS placé,
 *   une case vide devient une affectation « à remplacer » (sans chauffeur).
 * Tournée colis active : même question « séparées ou reliées » que
 * POST /api/planning/entries si le chauffeur a déjà une tournée un des jours
 * (une seule réponse vaut pour tous les jours), puis fiche colis préparée
 * pour chaque jour à venir. RLS : un manager ne place que sur ses services.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut attribuer une tournée." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { service_id, tour_number, driver_id, heure, regroupement, imposer_heure } = parsed.data;
  const dates = [...new Set(parsed.data.dates)].sort();
  const premier = dates[0]!;
  const dernier = dates[dates.length - 1]!;
  const supabase = await createServerSupabaseClient();
  const colis = g.modules.has("route_optimizer");

  const [{ data: chauffeur }, { data: existantes, error: lectureError }, absences, { data: attribues }] = await Promise.all([
    supabase.from("users").select("id").eq("id", driver_id).eq("organization_id", appUser.organization_id).eq("active", true).or(FILTRE_CONDUCTEURS).maybeSingle(),
    supabase
      .from("planning_entries")
      .select(CHAMPS)
      .eq("organization_id", appUser.organization_id)
      .eq("service_id", service_id)
      .eq("tour_number", tour_number)
      // Marge d'un jour : instants UTC, regroupés par jour de Paris.
      .gte("start_at", `${addDays(premier, -1)}T00:00:00Z`)
      .lt("start_at", `${addDays(dernier, 2)}T00:00:00Z`),
    lireAbsences(supabase, appUser.organization_id, premier, dernier),
    parsed.data.vehicle_id === undefined
      ? supabase.from("vehicles").select("id, service_id").eq("organization_id", appUser.organization_id).eq("assigned_driver_id", driver_id)
      : Promise.resolve({ data: null }),
  ]);
  if (!chauffeur) return NextResponse.json({ error: "Chauffeur introuvable ou inactif dans votre organisation." }, { status: 400 });
  if (lectureError) return NextResponse.json({ error: lectureError.message }, { status: 500 });

  const vehicule =
    parsed.data.vehicle_id !== undefined
      ? parsed.data.vehicle_id
      : (((attribues ?? []) as { id: string; service_id: string | null }[]).find((v) => v.service_id === service_id) ?? (attribues ?? [])[0])?.id ?? null;

  const decisions = decisionsAffectation({
    dates,
    driverId: driver_id,
    heure,
    imposerHeure: imposer_heure,
    existantes: (existantes ?? []) as AffectationPlanning[],
    absent: absentSelon(absences),
    versUtc: parisWallTimeToUtcISOString,
  });
  const aPlacer = decisions.filter((d) => (d.type === "creer" && d.driverId) || d.type === "changer").map((d) => d.date);
  const conducteur = { id: driver_id, organization_id: appUser.organization_id };

  // « Séparées ou reliées ? » : seulement les jours où le chauffeur a déjà
  // une autre tournée ou une fiche colis ouverte (deux lectures pour toute
  // la plage, puis la vérification complète sur ces jours-là).
  if (colis && !regroupement) {
    const aVenir = aPlacer.filter(ficheAPreparer);
    if (aVenir.length) {
      const [{ data: autres }, { data: fiches }] = await Promise.all([
        supabase
          .from("planning_entries")
          .select("start_at")
          .eq("organization_id", appUser.organization_id)
          .eq("driver_id", driver_id)
          .in("status", ["planned", "in_progress"])
          .gte("start_at", `${addDays(aVenir[0]!, -1)}T00:00:00Z`)
          .lt("start_at", `${addDays(aVenir[aVenir.length - 1]!, 2)}T00:00:00Z`),
        supabase.from("delivery_runs").select("run_date").eq("organization_id", appUser.organization_id).eq("driver_id", driver_id).neq("status", "done").in("run_date", aVenir),
      ]);
      const occupes = new Set([
        ...((autres ?? []) as { start_at: string }[]).map((e) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date(e.start_at))),
        ...((fiches ?? []) as { run_date: string }[]).map((f) => f.run_date),
      ]);
      for (const date of aVenir.filter((d) => occupes.has(d))) {
        const choix = await questionAvantAffectation(supabase, conducteur, date, undefined, "planning/affecter");
        if (choix) return NextResponse.json({ choix_requis: true, ...choix, dates: aVenir.filter((d) => occupes.has(d)) }, { status: 409 });
      }
    }
  }

  let places = 0;
  const ids: string[] = [];
  const avertissements: string[] = [];
  const absents: string[] = [];
  let figees = 0;
  let deja = 0;

  for (const d of decisions) {
    if (d.type === "rien") {
      if (d.raison === "figee") figees++;
      else if (d.raison === "deja") deja++;
      else absents.push(d.date);
      continue;
    }

    let ligne: any = null;
    if (d.type === "creer") {
      const { data, error } = await supabase
        .from("planning_entries")
        .insert({ organization_id: appUser.organization_id, service_id, tour_number, driver_id: d.driverId, vehicle_id: vehicule, start_at: d.startAt, status: "planned" })
        .select(CHAMPS)
        .single();
      if (error) {
        if (error.code === "23505") {
          avertissements.push("Un créneau venait d'être pris : rechargez le planning.");
          continue;
        }
        return NextResponse.json({ error: error.message, places, ids }, { status: 500 });
      }
      ligne = data;
      if (!d.driverId) {
        absents.push(d.date);
        ids.push(data.id);
        continue;
      }
    } else {
      if (d.ancienChauffeur) {
        const w = await libererFicheAncienChauffeur(supabase, d.entreeId);
        if (w) avertissements.push(w);
      }
      const existante = ((existantes ?? []) as AffectationPlanning[]).find((e) => e.id === d.entreeId);
      const { data, error } = await supabase
        .from("planning_entries")
        .update({ driver_id, ...(existante && !existante.vehicle_id && vehicule ? { vehicle_id: vehicule } : {}), ...(d.startAt ? { start_at: d.startAt } : {}) })
        .eq("id", d.entreeId)
        .eq("status", "planned")
        .select(CHAMPS)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message, places, ids }, { status: 500 });
      if (!data) {
        figees++;
        continue;
      }
      ligne = data;
    }

    places++;
    ids.push(ligne.id);
    const conflit = await warnIfDriverDoubleBooked(supabase, { organizationId: appUser.organization_id, driverId: driver_id, startAt: ligne.start_at, excludeEntryId: ligne.id });
    if (conflit) avertissements.push(conflit);
    if (colis) {
      const { warning } = await ficheApresAffectation(supabase, conducteur, ligne, d.date, regroupement, "planning/affecter");
      if (warning) avertissements.push(warning);
    }
  }

  return NextResponse.json({ places, absents, figees, deja, ids, warning: [...new Set(avertissements)].join(" ") || null });
}
