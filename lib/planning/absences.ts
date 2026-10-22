import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { estAbsent, type ArretPlanning } from "@/lib/planning/affectation";
import type { CongePlanning } from "@/lib/planning/semaine";

/**
 * Absences des salariés sur une période, pour le planning : congés
 * (leave_requests validés ou demandés) et arrêts de travail
 * (work_stoppages : maladie, AT, trajet, maternité, paternité, sans solde).
 *
 * Lecture avec le client de l'utilisateur : la RLS décide de ce qu'il voit.
 * Toujours « au mieux » : une table ou une colonne absente (migration non
 * appliquée) ou un refus de lecture donnent une liste vide, jamais une
 * erreur — le planning s'affiche et s'écrit quand même.
 */
export interface Absences {
  conges: CongePlanning[];
  arrets: ArretPlanning[];
}

interface LigneArret {
  user_id: string;
  stoppage_type?: string | null;
  start_date: string;
  end_date: string;
  status?: string | null;
}

/**
 * Arrêts retenus comme absences : tous sauf ceux refusés (colonne status
 * 'recu' | 'valide' | 'refuse', ajoutée plus tard : sans elle, tous comptent).
 */
export function arretsRetenus(lignes: readonly LigneArret[]): ArretPlanning[] {
  return lignes
    .filter((l) => l.user_id && l.start_date && l.end_date && l.status !== "refuse")
    .map((l) => ({ user_id: l.user_id, start_date: l.start_date, end_date: l.end_date, motif: l.stoppage_type ?? null }));
}

/** Absences qui touchent la période du → au (jours de Paris, inclus). */
export async function lireAbsences(supabase: SupabaseClient, organizationId: string, du: string, au: string): Promise<Absences> {
  const [conges, arrets] = await Promise.all([lireConges(supabase, organizationId, du, au), lireArrets(supabase, organizationId, du, au)]);
  return { conges, arrets };
}

async function lireConges(supabase: SupabaseClient, organizationId: string, du: string, au: string): Promise<CongePlanning[]> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("driver_id, start_date, end_date, status")
    .eq("organization_id", organizationId)
    .in("status", ["approved", "pending"])
    .lte("start_date", au)
    .gte("end_date", du);
  if (error) {
    if (!estSchemaManquant(error)) console.warn("[planning/absences] Congés non lus", error.message);
    return [];
  }
  return (data ?? []) as CongePlanning[];
}

async function lireArrets(supabase: SupabaseClient, organizationId: string, du: string, au: string): Promise<ArretPlanning[]> {
  const lire = (champs: string) =>
    supabase.from("work_stoppages").select(champs).eq("organization_id", organizationId).lte("start_date", au).gte("end_date", du);
  let { data, error } = await lire("user_id, stoppage_type, start_date, end_date, status");
  // Colonne status pas encore là : tous les arrêts comptent.
  if (error && estSchemaManquant(error)) ({ data, error } = await lire("user_id, stoppage_type, start_date, end_date"));
  if (error) {
    if (!estSchemaManquant(error)) console.warn("[planning/absences] Arrêts non lus", error.message);
    return [];
  }
  return arretsRetenus((data ?? []) as unknown as LigneArret[]);
}

/** « Absent ce jour-là ? » (congé validé ou arrêt) pour les duplications et l'affectation. */
export function absentSelon(absences: Absences): (driverId: string, date: string) => boolean {
  return (driverId, date) => estAbsent(driverId, date, absences.conges, absences.arrets);
}
