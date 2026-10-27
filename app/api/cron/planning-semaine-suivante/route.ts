import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { generationDuJour } from "@/lib/planning/semaines-auto";
import { genererSemaine } from "@/lib/planning/semaines-auto-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron HEBDOMADAIRE du jeudi, ~5-6 h à Paris (vercel.json : "0 4 * * 4", 4 h UTC),
 * même contrôle CRON_SECRET que les autres crons. Plan Vercel Hobby : une exécution
 * par jour au plus ; le déclenchement n'est garanti que dans l'heure prévue.
 *
 * Pour chaque organisation qui a le module Planning et chaque service
 * d'exploitation, génère la semaine suivante (lundi → dimanche, Europe/Paris)
 * à partir de la semaine en cours, SANS rien écraser
 * (lib/planning/semaines-auto-serveur.ts › genererSemaine) :
 *  - tournées fermées non recopiées, absents / congés / arrêts / comptes inactifs
 *    laissés « à remplacer » (jamais le motif d'un arrêt) ;
 *  - lignes NON publiées : invisibles des chauffeurs, aucune notification pour eux ;
 *  - une ligne planning_semaines_auto par service et par semaine : une seconde
 *    exécution ne refait rien ;
 *  - alerte « à confirmer avant vendredi 17 h » à la direction, l'exploitation et
 *    aux managers du service (cloche, push et e-mail par le webhook des alertes).
 * Sans la migration 20261111000001 : génération sautée avec un message, jamais d'erreur.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const jour = generationDuJour(new Date());
  if (!jour.ok) return NextResponse.json({ ok: true, skipped: true, reason: jour.raison });

  const admin = createAdminSupabaseClient();
  const { data: modules, error } = await admin.from("organization_modules").select("organization_id").eq("module_key", "planning").eq("enabled", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let generees = 0;
  let ignorees = 0;
  let migrationManquante = false;
  const erreurs: string[] = [];
  for (const { organization_id } of (modules ?? []) as { organization_id: string }[]) {
    // Une organisation en erreur n'empêche pas les autres.
    try {
      const bilan = await genererSemaine(admin, organization_id, { lundi: jour.semaine.lundi });
      if (bilan.migrationManquante) {
        migrationManquante = true;
        continue;
      }
      for (const s of bilan.services) {
        if (s.statut === "generee") generees++;
        else if (s.statut === "erreur") erreurs.push(`${organization_id} ${s.service}: ${s.message}`);
        else ignorees++;
      }
    } catch (err) {
      erreurs.push(`${organization_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (erreurs.length) console.error("cron planning de la semaine suivante", erreurs);
  return NextResponse.json({
    ok: true,
    semaine: jour.semaine.lundi,
    organisations: (modules ?? []).length,
    generees,
    ignorees,
    erreurs: erreurs.length,
    ...(migrationManquante ? { message: "Migration 20261111000001_planning_semaines_auto.sql pas encore appliquée : génération sautée." } : {}),
  });
}
