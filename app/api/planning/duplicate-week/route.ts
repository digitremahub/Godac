import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";
import { estCopiable, jourDe, joursDeLaSemaine, planifierCopies, type AffectationPlanning, type CopieDemandee } from "@/lib/planning/semaine";
import { affectationsAutour, inscrireCopies } from "@/lib/planning/copies-serveur";
import { absentSelon, lireAbsences } from "@/lib/planning/absences";

const bodySchema = z
  .object({
    source_week_start: z.string().date(),
    /** Une semaine cible précise (ancien appel : « copier la semaine précédente ici »). */
    target_week_start: z.string().date().optional(),
    /** Ou les N semaines qui suivent la semaine source (1 à 8). */
    weeks: z.number().int().min(1).max(8).optional(),
    service_id: z.string().uuid().optional(),
    /** Aperçu : compte ce qui serait créé / ignoré / en conflit, sans rien écrire. */
    dry_run: z.boolean().optional(),
  })
  .refine((b) => b.target_week_start || b.weeks, { message: "Indiquez la semaine cible ou le nombre de semaines." });

/**
 * « Dupliquer la semaine » — la plupart des chauffeurs refont les mêmes
 * tournées chaque semaine. Recopie chaque affectation de la semaine source
 * (même chauffeur, véhicule, tournée, heure de Paris) vers la semaine
 * cible ou vers les N semaines suivantes, toujours en « prévue ».
 * - créneau déjà occupé (service + tournée + départ, la contrainte unique
 *   de planning_entries) : ignoré — les saisies faites à la main gagnent ;
 * - chauffeur déjà pris à la même heure : créée, comptée « en conflit » ;
 * - chauffeur en congé validé ou en arrêt de travail ce jour-là : il n'est
 *   PAS placé, l'affectation est créée sans chauffeur (« à remplacer »).
 * `dry_run` renvoie l'aperçu (« 42 affectations seront créées… »).
 * Réservé à l'encadrement ; RLS limite un manager à ses services, en
 * lecture comme en écriture.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager", "exploitation"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut dupliquer le planning." }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { source_week_start, target_week_start, weeks, service_id, dry_run } = parsed.data;
  const supabase = await createServerSupabaseClient();

  const joursSource = new Set(joursDeLaSemaine(source_week_start));
  let sourceQuery = supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, vehicle_id, start_at, status")
    .eq("organization_id", appUser.organization_id)
    .gte("start_at", `${addDays(source_week_start, -1)}T00:00:00Z`)
    .lt("start_at", `${addDays(source_week_start, 8)}T00:00:00Z`);
  if (service_id) sourceQuery = sourceQuery.eq("service_id", service_id);
  const { data: sourceRows, error: sourceError } = await sourceQuery;
  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 });
  const sources = ((sourceRows ?? []) as AffectationPlanning[]).filter((e) => joursSource.has(jourDe(e.start_at)) && estCopiable(e));

  // Décalages en jours : une semaine cible précise, ou 7, 14… × N.
  const decalages = target_week_start
    ? [Math.round((Date.parse(`${target_week_start}T00:00:00Z`) - Date.parse(`${source_week_start}T00:00:00Z`)) / 86_400_000)]
    : Array.from({ length: weeks ?? 1 }, (_, k) => 7 * (k + 1));
  if (decalages.some((d) => d === 0)) {
    return NextResponse.json({ error: "La semaine cible doit être différente de la semaine source." }, { status: 400 });
  }
  const demandes: CopieDemandee[] = decalages.flatMap((d) => sources.map((source) => ({ source, date: addDays(jourDe(source.start_at), d) })));
  if (demandes.length === 0) {
    return NextResponse.json({ created: 0, skipped: 0, conflicts: 0, source_count: 0, dry_run: Boolean(dry_run) });
  }

  const cibles = demandes.map((d) => d.date).sort();
  let existantes: AffectationPlanning[];
  try {
    existantes = await affectationsAutour(supabase, appUser.organization_id, cibles);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lecture du planning impossible." }, { status: 500 });
  }
  const absences = await lireAbsences(supabase, appUser.organization_id, cibles[0]!, cibles[cibles.length - 1]!);
  const plan = planifierCopies(demandes, existantes, { absent: absentSelon(absences) });

  if (dry_run) {
    return NextResponse.json({ created: plan.aCreer.length, skipped: plan.ignorees.length, conflicts: plan.conflits.length, a_remplacer: plan.aRemplacer.length, source_count: sources.length, dry_run: true });
  }

  const r = await inscrireCopies(supabase, appUser.organization_id, plan);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ created: r.creees, skipped: r.ignorees, conflicts: r.conflits, a_remplacer: plan.aRemplacer.length, source_count: sources.length, warning: r.warning });
}
