import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { addDays, parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { dureeJourPrevueMinutes, entreeAClore, estimerSortie, type PointageARegulariser, type SourceEstimation } from "@/lib/time-clock/regularisation";

/**
 * Régularisation des pointages (lib/time-clock/regularisation.ts pour les
 * règles). Clôture nocturne par le client service (cron), liste lue sous la
 * RLS de la personne connectée. Tolérant à l'absence de la migration
 * 20261109000002 : sans les colonnes, rien n'est clos (comportement d'avant).
 */

const un = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

export interface BilanCloture {
  closes: number;
  /** Colonnes de la migration absentes : aucune clôture. */
  schemaManquant: boolean;
}

/**
 * Clôt les entrées ouvertes de plus de 16 h ou d'un jour précédent, par une
 * sortie estimée (fin planifiée, sinon entrée + durée prévue, sinon à saisir),
 * marquées « à régulariser », et prévient l'encadrement du service (le salarié
 * voit « sortie à confirmer » sur sa page de pointage). Une organisation à la fois ; `seulementUserId` : au badgeage d'une
 * personne dont l'entrée est restée ouverte, sans attendre la nuit.
 */
export async function cloturerPointagesOuverts(admin: SupabaseClient, organizationId: string, maintenant: Date = new Date(), seulementUserId?: string): Promise<BilanCloture> {
  let requete = admin
    .from("time_clock_entries")
    .select("id, user_id, clocked_in_at, needs_regularization, users!time_clock_entries_user_id_fkey(full_name)")
    .eq("organization_id", organizationId)
    .is("clocked_out_at", null)
    .limit(500);
  if (seulementUserId) requete = requete.eq("user_id", seulementUserId);
  const { data, error } = await requete;
  if (error) {
    if (estSchemaManquant(error)) return { closes: 0, schemaManquant: true };
    throw new Error(`pointages ouverts : ${error.message}`);
  }
  const aClore = ((data ?? []) as { id: string; user_id: string; clocked_in_at: string; users: { full_name: string } | { full_name: string }[] | null }[]).filter((e) => entreeAClore(e.clocked_in_at, maintenant));
  if (aClore.length === 0) return { closes: 0, schemaManquant: false };

  const userIds = [...new Set(aClore.map((e) => e.user_id))];
  const premierJour = aClore.reduce((m, e) => (parisCalendarDate(e.clocked_in_at) < m ? parisCalendarDate(e.clocked_in_at) : m), parisCalendarDate(aClore[0]!.clocked_in_at));
  const dernierJour = aClore.reduce((m, e) => (parisCalendarDate(e.clocked_in_at) > m ? parisCalendarDate(e.clocked_in_at) : m), premierJour);
  const [{ data: planning }, { data: profils }, { data: contrats }, { data: liens }] = await Promise.all([
    admin
      .from("planning_entries")
      .select("driver_id, start_at, end_at, status")
      .eq("organization_id", organizationId)
      .in("driver_id", userIds)
      .gte("start_at", parisWallTimeToUtcISOString(premierJour, "00:00"))
      .lt("start_at", parisWallTimeToUtcISOString(addDays(dernierJour, 1), "00:00")),
    admin.from("payroll_profiles").select("user_id, contractual_hours").eq("organization_id", organizationId).in("user_id", userIds),
    admin.from("user_contracts").select("user_id, contractual_monthly_hours").in("user_id", userIds),
    admin.from("user_services").select("user_id, service_id").in("user_id", userIds),
  ]);
  const heuresContrat = new Map<string, number>();
  for (const c of (contrats ?? []) as { user_id: string; contractual_monthly_hours: number | null }[]) if (c.contractual_monthly_hours) heuresContrat.set(c.user_id, Number(c.contractual_monthly_hours));
  for (const p of (profils ?? []) as { user_id: string; contractual_hours: number | null }[]) if (p.contractual_hours) heuresContrat.set(p.user_id, Number(p.contractual_hours));
  const serviceDe = new Map<string, string>();
  for (const l of ((liens ?? []) as { user_id: string; service_id: string }[]).sort((a, b) => a.service_id.localeCompare(b.service_id))) if (!serviceDe.has(l.user_id)) serviceDe.set(l.user_id, l.service_id);

  let closes = 0;
  for (const e of aClore) {
    const jour = parisCalendarDate(e.clocked_in_at);
    const fins = ((planning ?? []) as { driver_id: string; start_at: string; end_at: string | null; status: string }[])
      .filter((p) => p.driver_id === e.user_id && !["cancelled", "canceled", "annule", "annulee"].includes(p.status) && parisCalendarDate(p.start_at) === jour)
      .map((p) => p.end_at);
    const estimation = estimerSortie({ entree: e.clocked_in_at, finsPlanifiees: fins, dureePrevueMinutes: dureeJourPrevueMinutes(heuresContrat.get(e.user_id)), maintenant });
    const { data: maj, error: errMaj } = await admin
      .from("time_clock_entries")
      .update({
        // À saisir : entrée close à son propre instant (durée nulle, aucune heure comptée) en attendant la saisie.
        clocked_out_at: estimation.sortie ?? e.clocked_in_at,
        needs_regularization: true,
        auto_closed_at: maintenant.toISOString(),
        estimated_out_source: estimation.source,
      })
      .eq("id", e.id)
      .eq("organization_id", organizationId)
      .is("clocked_out_at", null)
      .select("id");
    if (errMaj) {
      if (estSchemaManquant(errMaj)) return { closes, schemaManquant: true };
      console.error("clôture pointage", errMaj.message);
      continue;
    }
    if (!maj || maj.length === 0) continue;
    closes++;
    await alerterPointage(admin, organizationId, { id: e.id, userId: e.user_id, nom: un(e.users)?.full_name ?? "Un salarié", entree: e.clocked_in_at, estimation, serviceId: serviceDe.get(e.user_id) ?? null });
  }
  return { closes, schemaManquant: false };
}

async function alerterPointage(
  admin: SupabaseClient,
  organizationId: string,
  p: { id: string; userId: string; nom: string; entree: string; estimation: { sortie: string | null; source: SourceEstimation }; serviceId: string | null },
) {
  const jour = new Date(p.entree).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit" });
  const lignes = [
    {
      organization_id: organizationId,
      type: "pointage_a_regulariser",
      severity: "warning",
      message: `Sortie oubliée le ${jour} : le pointage de ${p.nom} a été clos automatiquement${p.estimation.sortie ? " avec une heure estimée" : " sans heure de sortie"}. À régulariser dans Équipe › Pointage.`,
      related_table: "time_clock_entries",
      related_id: p.id,
      recipient_roles: ["manager", "exploitation", "direction"],
      cle_dedoublonnage: `pointage:${p.id}:encadrement`,
      ...(p.serviceId ? { service_id: p.serviceId } : {}),
    },
  ];
  for (const ligne of lignes) {
    const { error } = await admin.from("alerts").insert(ligne);
    // 23505 : déjà créée ; type d'alerte ou colonne absents (migrations pas appliquées) : ignoré.
    if (error && error.code !== "23505" && !estSchemaManquant(error) && !estValeurEnumInconnue(error)) console.error("alerte pointage", error.message);
  }
}

/** Pointages à régulariser lisibles par la personne connectée (RLS : manager son service, exploitation et direction l'organisation). */
export async function listerPointagesARegulariser(db: SupabaseClient, organizationId: string, limite = 100): Promise<PointageARegulariser[]> {
  const { data, error } = await db
    .from("time_clock_entries")
    .select("id, user_id, clocked_in_at, clocked_out_at, estimated_out_source, users!time_clock_entries_user_id_fkey(full_name)")
    .eq("organization_id", organizationId)
    .eq("needs_regularization", true)
    .order("clocked_in_at", { ascending: true })
    .limit(limite);
  if (error) {
    if (estSchemaManquant(error)) return [];
    throw new Error(`pointages à régulariser : ${error.message}`);
  }
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    userId: r.user_id,
    nom: un<{ full_name: string }>(r.users)?.full_name ?? "—",
    entree: r.clocked_in_at,
    sortieEstimee: r.estimated_out_source === "a_saisir" ? null : r.clocked_out_at,
    source: (r.estimated_out_source as SourceEstimation | null) ?? null,
    clos: true,
  }));
}

/** Le salarié a-t-il un pointage à confirmer (sa propre sortie estimée) ? */
export async function sortieAConfirmer(db: SupabaseClient, userId: string): Promise<PointageARegulariser | null> {
  const { data, error } = await db
    .from("time_clock_entries")
    .select("id, user_id, clocked_in_at, clocked_out_at, estimated_out_source")
    .eq("user_id", userId)
    .eq("needs_regularization", true)
    .order("clocked_in_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  const r = data[0] as { id: string; user_id: string; clocked_in_at: string; clocked_out_at: string | null; estimated_out_source: SourceEstimation | null };
  return { id: r.id, userId: r.user_id, nom: "", entree: r.clocked_in_at, sortieEstimee: r.estimated_out_source === "a_saisir" ? null : r.clocked_out_at, source: r.estimated_out_source, clos: true };
}
