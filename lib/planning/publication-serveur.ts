import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { minuitParis } from "@/lib/ticpe/export";
import { addDays } from "@/lib/planning/dates";
import { estSchemaManquant } from "@/lib/rattachement/tolerance";
import { cleSemaine, destinatairesPublication, messagePublication, periodePublication, type AffectationPubliee, type ChangementAPublier } from "@/lib/planning/publication";
import { marquerSemainesPubliees } from "@/lib/planning/suivi-auto-serveur";

/**
 * Publication du planning aux chauffeurs (« Publier aux chauffeurs », confirmation
 * d'une semaine générée automatiquement, envoi automatique du vendredi) : UNE
 * notification par chauffeur concerné, avec le récapitulatif de ses tournées
 * (lib/planning/publication.ts). Fonction unique, appelée par
 * app/api/planning/publier, app/api/planning/semaine-suivante/confirmer et
 * app/api/cron/planning-envoi-auto.
 *
 * - pose planning_validations pour chaque service × semaine : la semaine est
 *   publiée, les changements suivants sont suivis (migration
 *   20261030000003_planning_publication.sql) ;
 * - marque les semaines générées automatiquement comme publiées
 *   (planning_semaines_auto) : leurs lignes deviennent visibles des chauffeurs ;
 * - sans cette migration (planning_changements absente) : récapitulatif à tous
 *   les chauffeurs de la période, comme l'ancien « Valider et envoyer ».
 * `db` lit et valide : le client de la personne connectée (RLS : un manager
 * publie ses services) ou le client service pour le cron. Alertes et nettoyage
 * des changements passent par le client service (alerts n'a pas de policy
 * d'insertion pour les clients) ; le rôle est vérifié par l'appelant.
 */
export interface ParamsPublication {
  db: SupabaseClient;
  organizationId: string;
  /** Auteur de la publication (planning_validations.validated_by). */
  validateurId: string;
  serviceIds: readonly string[];
  /** Période : la publication porte sur ses semaines entières. */
  debut: string;
  fin: string;
  mode: "manuel" | "auto";
  /** Client service déjà créé par l'appelant (sinon créé au besoin). */
  admin?: SupabaseClient;
}

export type ResultatPublication =
  | { ok: true; sent: number; debut: string; fin: string; suivi: boolean }
  /** `validee` : les semaines étaient déjà publiées quand l'erreur est survenue (notifications). */
  | { ok: false; status: number; error: string; validee: boolean };

export async function publierSemaines(p: ParamsPublication): Promise<ResultatPublication> {
  const periode = periodePublication(p.debut, p.fin);
  const serviceIds = [...p.serviceIds];
  const depuis = minuitParis(periode.debut);
  const avant = minuitParis(addDays(periode.fin, 1));

  const [{ data: validations }, { data: entrees, error: entreesError }, changementsLus] = await Promise.all([
    p.db.from("planning_validations").select("service_id, week_start").eq("organization_id", p.organizationId).in("service_id", serviceIds).in("week_start", periode.lundis),
    p.db
      .from("planning_entries")
      .select("driver_id, service_id, tour_number, start_at, status, vehicles(registration)")
      .eq("organization_id", p.organizationId)
      .in("service_id", serviceIds)
      .eq("status", "planned")
      .not("driver_id", "is", null)
      .gte("start_at", depuis)
      .lt("start_at", avant)
      .order("start_at"),
    p.db
      .from("planning_changements")
      .select("id, driver_id, service_id, tour_number, start_at, nature")
      .eq("organization_id", p.organizationId)
      .in("service_id", serviceIds)
      .gte("start_at", depuis)
      .lt("start_at", avant),
  ]);
  if (entreesError) return { ok: false, status: 500, error: entreesError.message, validee: false };
  if (changementsLus.error && !estSchemaManquant(changementsLus.error)) return { ok: false, status: 500, error: changementsLus.error.message, validee: false };
  const changements = changementsLus.error ? null : ((changementsLus.data ?? []) as ChangementAPublier[]);

  const publiees = new Set(((validations ?? []) as { service_id: string; week_start: string }[]).map((v) => cleSemaine(v.service_id, v.week_start)));
  const destinataires = destinatairesPublication({ affectations: (entrees ?? []) as unknown as AffectationPubliee[], changements, publiees });

  // 1. Semaines publiées (le trigger suit désormais leurs changements).
  const lignes = serviceIds.flatMap((service_id) =>
    periode.lundis.map((week_start) => ({ organization_id: p.organizationId, service_id, week_start, validated_at: new Date().toISOString(), validated_by: p.validateurId })),
  );
  const { error: validationError } = await p.db.from("planning_validations").upsert(lignes, { onConflict: "organization_id,service_id,week_start" });
  if (validationError) return { ok: false, status: 500, error: validationError.message, validee: false };

  let admin = p.admin;
  if (!admin && (destinataires.length || changements?.length)) {
    try {
      admin = createAdminSupabaseClient();
    } catch {
      return { ok: false, status: 500, error: "Envoi des notifications indisponible (configuration du serveur).", validee: true };
    }
  }

  // 2. Semaines générées automatiquement : désormais publiées, visibles des chauffeurs (avant leurs notifications).
  if (!admin) {
    try {
      admin = createAdminSupabaseClient();
    } catch {
      admin = undefined;
    }
  }
  if (admin) await marquerSemainesPubliees(admin, { organizationId: p.organizationId, serviceIds, lundis: periode.lundis, mode: p.mode, userId: p.validateurId });

  // 3. Une notification par chauffeur, 4. changements publiés effacés.
  if (admin && (destinataires.length || changements?.length)) {
    if (destinataires.length) {
      const { error } = await admin.from("alerts").insert(
        destinataires.map((d) => ({
          organization_id: p.organizationId,
          type: "planning_validated",
          severity: "info",
          message: messagePublication(d),
          related_table: "planning_entries",
          recipient_user_id: d.driverId,
        })),
      );
      if (error) return { ok: false, status: 500, error: error.message, validee: true };
    }
    if (changements?.length) {
      const { error } = await admin.from("planning_changements").delete().in("id", changements.map((c) => c.id));
      if (error) console.warn("[planning/publier] Changements publiés non effacés", error.message);
    }
  }

  return { ok: true, sent: destinataires.length, debut: periode.debut, fin: periode.fin, suivi: changements !== null };
}
