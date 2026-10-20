import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/planning/dates";
import { copiesVersDates, estCopiable, jourDe, planifierCopies, type AffectationPlanning } from "@/lib/planning/semaine";
import { affectationsAutour, inscrireCopies } from "@/lib/planning/copies-serveur";

const bodySchema = z.object({
  /** Ancien appel : un seul jour (défaut : même jour la semaine suivante). */
  target_date: z.string().date().optional(),
  /** Plusieurs jours cochés (L M M J V S D, « jusqu'à la fin de la semaine »). */
  target_dates: z.array(z.string().date()).min(1).max(62).optional(),
  /** Copier / coller vers la ligne d'un autre chauffeur. */
  driver_id: z.string().uuid().optional(),
  vehicle_id: z.string().uuid().optional(),
});

/**
 * « Dupliquer une affectation » — clone une affectation (même tournée,
 * service, véhicule, heure de Paris) vers un ou plusieurs jours, et
 * éventuellement vers un autre chauffeur (copier / coller). Toute source
 * (prévue, en cours, terminée) se duplique ; la copie est toujours
 * « prévue ». Un créneau déjà occupé (même service, tournée et départ :
 * contrainte unique de planning_entries) est ignoré, jamais en erreur ;
 * un chauffeur déjà pris à la même heure est signalé (conflit), pas bloqué.
 * Réservé à l'encadrement ; RLS limite un manager à ses services.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!["direction", "manager"].includes(appUser.role)) {
    return NextResponse.json({ error: "Seule la Direction, le responsable exploitation ou le chef d’équipe peut dupliquer une tournée." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const supabase = await createServerSupabaseClient();

  const { data: source, error: sourceError } = await supabase
    .from("planning_entries")
    .select("id, service_id, tour_number, driver_id, vehicle_id, start_at, status")
    .eq("id", id)
    .eq("organization_id", appUser.organization_id)
    .single();
  if (sourceError || !source) {
    return NextResponse.json({ error: "Affectation introuvable." }, { status: 404 });
  }
  const affectation = source as AffectationPlanning;
  const avecSurcharge = { ...affectation, driver_id: parsed.data.driver_id ?? affectation.driver_id, vehicle_id: parsed.data.vehicle_id ?? affectation.vehicle_id };
  if (!estCopiable(avecSurcharge)) {
    return NextResponse.json({ error: "Cette affectation ne peut pas être dupliquée (présence, annulée, ou sans chauffeur ni véhicule)." }, { status: 400 });
  }

  const dates = parsed.data.target_dates ?? [parsed.data.target_date ?? addDays(jourDe(affectation.start_at), 7)];
  let existantes: AffectationPlanning[];
  try {
    existantes = await affectationsAutour(supabase, appUser.organization_id, dates);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Lecture du planning impossible." }, { status: 500 });
  }
  const plan = planifierCopies(copiesVersDates([affectation], dates, { driverId: parsed.data.driver_id, vehicleId: parsed.data.vehicle_id }), existantes);
  const r = await inscrireCopies(supabase, appUser.organization_id, plan);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  return NextResponse.json({ id: r.ids[0] ?? null, ids: r.ids, created: r.creees, skipped: r.ignorees, conflicts: r.conflits, warning: r.warning });
}
