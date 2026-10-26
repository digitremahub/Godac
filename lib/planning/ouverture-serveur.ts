import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { messageTourneeFermee } from "@/lib/planning/ouverture";

/**
 * Ouverture / fermeture d'une tournée du planning : lectures tolérantes
 * (migration 20261105000001 non appliquée = toute tournée est ouverte).
 */

export interface EtatOuverture {
  ouverte: boolean;
  fermeePar: string | null;
  fermeeLe: string | null;
}

const OUVERTE: EtatOuverture = { ouverte: true, fermeePar: null, fermeeLe: null };

/** Nom de la personne qui a fermé (lecture admin : un chauffeur ne lit pas la fiche d'un manager). */
async function nomDe(organizationId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await createAdminSupabaseClient().from("users").select("full_name").eq("id", userId).eq("organization_id", organizationId).maybeSingle();
  return (data as { full_name?: string | null } | null)?.full_name ?? null;
}

/**
 * Une tournée du planning est-elle fermée ? Lecture admin, bornée à
 * l'organisation : le chauffeur qui démarre doit voir « fermée par … » même
 * si la ligne ne lui donne pas la fiche de celui qui l'a fermée.
 */
export async function etatOuverture(organizationId: string, entryId: string): Promise<EtatOuverture> {
  try {
    const { data, error } = await createAdminSupabaseClient()
      .from("planning_entries")
      .select("tour_open, closed_at, closed_by")
      .eq("id", entryId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) {
      if (!estSchemaManquant(error)) console.warn("[planning] Ouverture non lue", error.message);
      return OUVERTE;
    }
    const e = data as { tour_open?: boolean | null; closed_at?: string | null; closed_by?: string | null } | null;
    if (!e || e.tour_open !== false) return OUVERTE;
    return { ouverte: false, fermeePar: await nomDe(organizationId, e.closed_by ?? null), fermeeLe: e.closed_at ?? null };
  } catch (e) {
    console.warn("[planning] Ouverture non lue", e instanceof Error ? e.message : e);
    return OUVERTE;
  }
}

/** Message « Tournée fermée par … » si cette tournée est fermée, sinon null. */
export async function refusSiFermee(organizationId: string, entryId: string | null | undefined, pour: "chauffeur" | "encadrement" = "chauffeur"): Promise<string | null> {
  if (!entryId) return null;
  const etat = await etatOuverture(organizationId, entryId);
  return etat.ouverte ? null : messageTourneeFermee(etat.fermeePar, etat.fermeeLe, pour);
}

/**
 * Fiches Tournée colis en cours liées à une affectation (par
 * delivery_runs.planning_entry_id ou planning_entries.delivery_run_id).
 */
export async function fichesEnCoursDe(supabase: SupabaseClient, organizationId: string, entryId: string, deliveryRunId: string | null): Promise<number> {
  const ids = new Set<string>();
  const { data: origines } = await supabase.from("delivery_runs").select("id").eq("organization_id", organizationId).eq("planning_entry_id", entryId).eq("status", "in_progress");
  for (const r of (origines ?? []) as { id: string }[]) ids.add(r.id);
  if (deliveryRunId) {
    const { data: portee } = await supabase.from("delivery_runs").select("id").eq("organization_id", organizationId).eq("id", deliveryRunId).eq("status", "in_progress");
    for (const r of (portee ?? []) as { id: string }[]) ids.add(r.id);
  }
  return ids.size;
}

/**
 * Le chauffeur démarre sa fiche Tournée colis : refus « Tournée fermée par … »
 * si l'affectation qu'elle porte (planning_entry_id d'origine ou
 * planning_entries.delivery_run_id) est fermée. null : pas de blocage.
 */
export async function refusDemarrageFiche(organizationId: string, runId: string): Promise<string | null> {
  const admin = createAdminSupabaseClient();
  const entrees = new Set<string>();
  try {
    const { data } = await admin.from("delivery_runs").select("planning_entry_id").eq("organization_id", organizationId).eq("id", runId).maybeSingle();
    const origine = (data as { planning_entry_id?: string | null } | null)?.planning_entry_id;
    if (origine) entrees.add(origine);
    const { data: portees } = await admin.from("planning_entries").select("id").eq("organization_id", organizationId).eq("delivery_run_id", runId);
    for (const e of (portees ?? []) as { id: string }[]) entrees.add(e.id);
  } catch {
    /* colonnes absentes (migrations pas appliquées) : pas de blocage */
  }
  for (const id of entrees) {
    const refus = await refusSiFermee(organizationId, id);
    if (refus) return refus;
  }
  return null;
}
