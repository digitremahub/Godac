import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { affectationsALiberer } from "@/lib/arrets/declaration";
import { affectationsPendantArret } from "@/lib/arrets/serveur";
import { alerterNiveauSuperieur } from "@/lib/hierarchie/serveur";
import { messageAffectationsConge } from "@/lib/leaves/controle";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";

/**
 * Congés ↔ planning. L'approbation d'un congé signale (et, sur demande, libère)
 * les affectations déjà posées sur ces jours, comme le font les arrêts de
 * travail (lib/arrets/serveur.ts, app/api/arrets/[id]/liberer) : on réutilise
 * leurs lectures et leurs règles (affectations encore prévues et à venir ;
 * une tournée démarrée ne se modifie pas d'ici).
 */

/** Affectations du salarié encore à faire pendant ce congé. */
export async function affectationsDuConge(db: SupabaseClient, organizationId: string, driverId: string, du: string, au: string) {
  return affectationsPendantArret(db, organizationId, driverId, du, au);
}

/**
 * Prévient l'encadrement (niveau au-dessus du salarié, avec escalade) : alerte
 * relayée en cloche, push et e-mail, qui ouvre le planning à la première
 * affectation touchée. Type « planning_conflict » : un type existant, sans migration.
 */
export async function signalerAffectationsConge(admin: SupabaseClient, p: { organizationId: string; driverId: string; nom: string; du: string; au: string; affectationIds: string[] }): Promise<void> {
  if (p.affectationIds.length === 0) return;
  const erreur = await alerterNiveauSuperieur(admin, {
    organizationId: p.organizationId,
    demandeurId: p.driverId,
    type: "planning_conflict",
    severity: "warning",
    message: messageAffectationsConge({ nom: p.nom, du: p.du, au: p.au, nombre: p.affectationIds.length }),
    relatedTable: "planning_entries",
    relatedId: p.affectationIds[0]!,
  });
  if (erreur) console.error("congé : alerte planning non créée", erreur);
}

/**
 * Nombre d'affectations libérables (prévues et à venir) pour chaque congé approuvé (une
 * lecture pour toute la liste), sous la RLS du planning de la personne connectée.
 */
export async function affectationsParConge(
  db: SupabaseClient,
  organizationId: string,
  conges: { id: string; driver_id: string; start_date: string; end_date: string; status: string }[],
  aujourdhui: string,
): Promise<Map<string, number>> {
  const resultat = new Map<string, number>();
  const approuves = conges.filter((c) => c.status === "approved" && c.end_date >= aujourdhui);
  if (approuves.length === 0) return resultat;
  const du = approuves.reduce((m, c) => (c.start_date < m ? c.start_date : m), approuves[0]!.start_date);
  const au = approuves.reduce((m, c) => (c.end_date > m ? c.end_date : m), approuves[0]!.end_date);
  const { data, error } = await db
    .from("planning_entries")
    .select("id, start_at, status, driver_id")
    .eq("organization_id", organizationId)
    .in("driver_id", [...new Set(approuves.map((c) => c.driver_id))])
    .in("status", ["planned", "in_progress"])
    .gte("start_at", parisWallTimeToUtcISOString(du, "00:00"))
    .lt("start_at", parisWallTimeToUtcISOString(addDays(au, 1), "00:00"));
  if (error) return resultat;
  const lignes = (data ?? []) as { id: string; start_at: string; status: string; driver_id: string }[];
  for (const c of approuves) {
    const n = affectationsALiberer(lignes.filter((l) => l.driver_id === c.driver_id), { du: c.start_date, au: c.end_date }).length;
    if (n > 0) resultat.set(c.id, n);
  }
  return resultat;
}
