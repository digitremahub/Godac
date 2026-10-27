import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { estSchemaManquant, estValeurEnumInconnue } from "@/lib/rattachement/tolerance";
import { jourDe } from "@/lib/planning/semaine";
import { lundiDe } from "@/lib/planning/publication";
import { CHAMPS_SUIVI, semainesMasquees, type LigneSuivi } from "@/lib/planning/semaines-auto";

/**
 * Accès à planning_semaines_auto (migration 20261111000001), le suivi des
 * semaines générées automatiquement. Écriture par le client service role
 * seulement (la table n'a pas de policy d'écriture) ; les rôles sont vérifiés
 * par les routes AU-DESSUS. Toujours tolérant : table absente (migration pas
 * appliquée) = aucun suivi, jamais une erreur.
 */

type Db = SupabaseClient;

export type LectureSuivi = { ok: true; lignes: LigneSuivi[] } | { ok: false; tableAbsente: boolean; error: string };

/** Lignes de suivi d'une organisation, filtrées par semaine, services ou état. */
export async function lireSuivi(db: Db, organizationId: string, filtres: { lundi?: string; lundis?: readonly string[]; serviceIds?: readonly string[]; enAttente?: boolean } = {}): Promise<LectureSuivi> {
  let q = db.from("planning_semaines_auto").select(CHAMPS_SUIVI).eq("organization_id", organizationId);
  if (filtres.lundi) q = q.eq("semaine_debut", filtres.lundi);
  if (filtres.lundis?.length) q = q.in("semaine_debut", [...filtres.lundis]);
  if (filtres.serviceIds) {
    if (!filtres.serviceIds.length) return { ok: true, lignes: [] };
    q = q.in("service_id", [...filtres.serviceIds]);
  }
  if (filtres.enAttente) q = q.is("publie_at", null);
  const { data, error } = await q.limit(1000);
  if (error) return { ok: false, tableAbsente: estSchemaManquant(error), error: error.message };
  return { ok: true, lignes: (data ?? []) as LigneSuivi[] };
}

/** Semaines générées et pas encore publiées (clés « service|lundi »), pour les crons qui écrivent aux chauffeurs. Table absente : aucune. */
export async function semainesMasqueesDe(db: Db, organizationId: string): Promise<Set<string>> {
  const r = await lireSuivi(db, organizationId, { enAttente: true });
  if (!r.ok) {
    if (!r.tableAbsente) console.warn("[planning] Semaines à confirmer non lues", r.error);
    return new Set();
  }
  return semainesMasquees(r.lignes);
}

export interface CibleModification {
  serviceId: string | null | undefined;
  /** Instant de la ligne touchée (jour de Paris déduit) ... */
  startAt?: string | null;
  /** ... ou jour de Paris (AAAA-MM-JJ). */
  jour?: string | null;
}

/**
 * POINT D'ENTRÉE UNIQUE des modifications manuelles du planning : renseigne
 * `modifie_at` (une seule fois, la première) sur la semaine générée automatiquement
 * qui contient la ligne, tant qu'elle n'est pas publiée. Appelé par les routes de
 * modification (affecter, entries, fermetures, duplication, modèles, fusion…). Sans
 * suivi pour cette semaine, ou sans la table : ne fait rien. Ne bloque jamais l'opération.
 */
export async function noterModificationPlanning(organizationId: string, cibles: readonly CibleModification[]): Promise<void> {
  const paires = new Map<string, { service: string; lundi: string }>();
  for (const c of cibles) {
    const jour = c.jour ?? (c.startAt ? jourDe(c.startAt) : null);
    if (!c.serviceId || !jour) continue;
    const lundi = lundiDe(jour);
    paires.set(`${c.serviceId}|${lundi}`, { service: c.serviceId, lundi });
  }
  if (!paires.size) return;
  try {
    const admin = createAdminSupabaseClient();
    const maintenant = new Date().toISOString();
    for (const { service, lundi } of paires.values()) {
      const { error } = await admin
        .from("planning_semaines_auto")
        .update({ modifie_at: maintenant })
        .eq("organization_id", organizationId)
        .eq("service_id", service)
        .eq("semaine_debut", lundi)
        .is("modifie_at", null)
        .is("publie_at", null);
      if (error && !estSchemaManquant(error)) console.warn("[planning] Modification de la semaine générée non notée", error.message);
    }
  } catch (e) {
    console.warn("[planning] Modification de la semaine générée non notée", e instanceof Error ? e.message : e);
  }
}

/** Même chose pour les routes qui ne connaissent que l'identifiant de la ligne touchée. */
export async function noterModificationEntree(organizationId: string, entreeId: string): Promise<void> {
  try {
    const admin = createAdminSupabaseClient();
    const { data } = await admin.from("planning_entries").select("service_id, start_at").eq("organization_id", organizationId).eq("id", entreeId).maybeSingle();
    if (data?.service_id && data.start_at) await noterModificationPlanning(organizationId, [{ serviceId: data.service_id as string, startAt: data.start_at as string }]);
  } catch (e) {
    console.warn("[planning] Modification de la semaine générée non notée", e instanceof Error ? e.message : e);
  }
}

/**
 * Réserve la publication d'une semaine (une seule exécution gagne : la
 * confirmation d'une personne et le cron du vendredi ne publient pas deux fois).
 * Pose publie_at tout de suite : les lignes deviennent lisibles des chauffeurs.
 */
export async function reserverPublication(admin: Db, ligneId: string, mode: "auto" | "manuel", confirmePar: string | null): Promise<boolean> {
  const maintenant = new Date().toISOString();
  const { data, error } = await admin
    .from("planning_semaines_auto")
    .update({ publie_at: maintenant, publie_mode: mode, confirme_at: mode === "manuel" ? maintenant : null, confirme_par: mode === "manuel" ? confirmePar : null })
    .eq("id", ligneId)
    .is("publie_at", null)
    .is("confirme_at", null)
    .select("id");
  if (error) {
    console.warn("[planning] Publication de la semaine non réservée", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** Annule la réservation quand la publication échoue avant d'avoir écrit quoi que ce soit : la semaine redevient masquée et publiable. */
export async function libererPublication(admin: Db, ligneId: string): Promise<void> {
  const { error } = await admin.from("planning_semaines_auto").update({ publie_at: null, publie_mode: null, confirme_at: null, confirme_par: null }).eq("id", ligneId);
  if (error) console.warn("[planning] Réservation de la publication non levée", error.message);
}

/** Une seule alerte de rappel par semaine : la première exécution qui pose rappel_envoye_at l'emporte. */
export async function reserverRappel(admin: Db, ligneId: string): Promise<boolean> {
  const { data, error } = await admin.from("planning_semaines_auto").update({ rappel_envoye_at: new Date().toISOString() }).eq("id", ligneId).is("rappel_envoye_at", null).select("id");
  if (error) {
    console.warn("[planning] Rappel non réservé", error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Une publication (« Publier aux chauffeurs » ou confirmation) marque aussi les
 * semaines suivies qu'elle couvre : elles deviennent visibles des chauffeurs et
 * sortent de « À traiter ». Sans effet pour les semaines déjà marquées.
 */
export async function marquerSemainesPubliees(admin: Db, p: { organizationId: string; serviceIds: readonly string[]; lundis: readonly string[]; mode: "auto" | "manuel"; userId: string | null }): Promise<void> {
  if (!p.serviceIds.length || !p.lundis.length) return;
  const maintenant = new Date().toISOString();
  const { data, error } = await admin
    .from("planning_semaines_auto")
    .update({ publie_at: maintenant, publie_mode: p.mode, confirme_at: p.mode === "manuel" ? maintenant : null, confirme_par: p.mode === "manuel" ? p.userId : null })
    .eq("organization_id", p.organizationId)
    .in("service_id", [...p.serviceIds])
    .in("semaine_debut", [...p.lundis])
    .is("publie_at", null)
    .select("id");
  if (error) {
    if (!estSchemaManquant(error)) console.warn("[planning] Semaines suivies non marquées publiées", error.message);
    return;
  }
  await cloreAlertesPlanning(admin, p.organizationId, ((data ?? []) as { id: string }[]).map((l) => l.id));
}

/**
 * Clôt les alertes « planning à confirmer » (génération, rappel) des semaines
 * confirmées ou publiées : elles ne comptent plus dans les notifications
 * ouvertes. Jamais bloquant ; type d'alerte absent (migration 20261111000002
 * pas appliquée) : rien à clore. Retourne le nombre d'alertes closes.
 */
export async function cloreAlertesPlanning(admin: Db, organizationId: string, ligneIds: readonly string[]): Promise<number> {
  if (!ligneIds.length) return 0;
  const { data, error } = await admin
    .from("alerts")
    .update({ status: "resolved", acknowledged_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("type", "planning_a_confirmer")
    .in("related_id", [...ligneIds])
    .in("status", ["open", "acknowledged"])
    .select("id");
  if (error) {
    if (!estSchemaManquant(error) && !estValeurEnumInconnue(error)) console.warn("[planning] Alertes de la semaine non closes", error.message);
    return 0;
  }
  return (data ?? []).length;
}
