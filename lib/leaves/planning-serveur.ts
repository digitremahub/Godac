import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { affectationsALiberer } from "@/lib/arrets/declaration";
import { affectationsPendantArret } from "@/lib/arrets/serveur";
import { alerterNiveauSuperieur } from "@/lib/hierarchie/serveur";
import { messageAffectationsConge } from "@/lib/leaves/controle";
import { addDays, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { lundiDe } from "@/lib/planning/publication";
import { jourDe } from "@/lib/planning/semaine";
import { ROLES_DESTINATAIRES_PLANNING, messageAbsenceApparue } from "@/lib/planning/semaines-auto";
import { lireSuivi } from "@/lib/planning/suivi-auto-serveur";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";

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
 * Congé approuvé APRÈS la génération automatique du planning de la semaine
 * suivante : pour chaque service dont la semaine est générée mais ni confirmée ni
 * publiée, signalement (même type « planning_conflict » que ci-dessus) à
 * l'encadrement qui voit déjà cette semaine : direction, exploitation et managers
 * du service. Une alerte par service et par semaine (clé de dédoublonnage, sans
 * elle la colonne absente est ignorée). Jamais de motif. Retourne le nombre d'alertes créées.
 */
export async function signalerAbsenceSemaineGeneree(
  admin: SupabaseClient,
  p: { organizationId: string; driverId: string; nom: string; du: string; au: string; affectations: readonly { id: string; service_id: string | null; start_at: string }[] },
): Promise<number> {
  const parSemaine = new Map<string, { service: string; lundi: string; ids: string[] }>();
  for (const a of p.affectations) {
    if (!a.service_id) continue;
    const lundi = lundiDe(jourDe(a.start_at));
    const k = `${a.service_id}|${lundi}`;
    const e = parSemaine.get(k) ?? { service: a.service_id, lundi, ids: [] };
    e.ids.push(a.id);
    parSemaine.set(k, e);
  }
  if (parSemaine.size === 0) return 0;
  const suivi = await lireSuivi(admin, p.organizationId, { lundis: [...new Set([...parSemaine.values()].map((e) => e.lundi))], enAttente: true });
  if (!suivi.ok) return 0;
  const attente = new Map(suivi.lignes.filter((l) => !l.confirme_at).map((l) => [`${l.service_id}|${l.semaine_debut}`, l]));
  let creees = 0;
  for (const [k, e] of parSemaine) {
    if (!attente.has(k)) continue;
    const ligne = {
      organization_id: p.organizationId,
      type: "planning_conflict",
      severity: "warning",
      message: messageAbsenceApparue({ nom: p.nom, du: p.du, au: p.au, lundi: e.lundi, nombre: e.ids.length }),
      related_table: "planning_entries",
      related_id: e.ids[0]!,
      recipient_roles: [...ROLES_DESTINATAIRES_PLANNING],
      service_id: e.service,
    };
    const cle = `planning:conge:${e.service}:${e.lundi}:${p.driverId}:${p.du}`;
    let { error } = await admin.from("alerts").insert({ ...ligne, cle_dedoublonnage: cle });
    if (error && estSchemaManquant(error)) ({ error } = await admin.from("alerts").insert(ligne));
    if (error && error.code !== "23505") console.error("congé : alerte de la semaine générée non créée", error.message);
    else if (!error) creees++;
  }
  return creees;
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
