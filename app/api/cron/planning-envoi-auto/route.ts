import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { envoyerSemainesAuto } from "@/lib/planning/semaines-auto-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron du VENDREDI, planifié deux fois (vercel.json : "0 15 * * 5" et "0 16 * * 5") :
 * 17 h à Paris = 15 h UTC l'été et 16 h UTC l'hiver. Le handler calcule l'heure de
 * Paris et n'agit que si c'est vendredi à 17:00 ou plus (decisionEnvoiAuto) ; les
 * deux passages sont donc idempotents (publie_at déjà posé : rien). Les deux entrées de
 * vercel.json portent un paramètre (?creneau=) qui ne sert qu'à les distinguer : le
 * handler l'ignore.
 *
 * LIMITE DU PLAN HOBBY : Vercel ne garantit le déclenchement que « dans l'heure »
 * prévue, pas à la minute. L'envoi a lieu en pratique entre 17:00 et 17:59, heure de
 * Paris. Pour 17:00 pile : Supabase pg_cron (appel HTTP de cette route avec le
 * secret CRON_SECRET, à 15:00 et 16:00 UTC le vendredi) ou le plan Vercel Pro.
 *
 * Pour chaque service dont la semaine suivante a été générée et n'est ni confirmée
 * ni publiée :
 *  - NON modifiée : publication automatique (même fonction que « Confirmer »),
 *    notification des chauffeurs, alerte d'information à l'encadrement ;
 *  - modifiée à la main mais pas confirmée : PAS d'envoi (on n'envoie pas un planning
 *    à moitié édité), rappel critique « confirmez maintenant », une seule fois
 *    (constante PUBLICATION_AUTO_SI_MODIFIE, lib/planning/semaines-auto.ts).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const maintenant = new Date();
  const { data: modules, error } = await admin.from("organization_modules").select("organization_id").eq("module_key", "planning").eq("enabled", true);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let envoyees = 0;
  let rappels = 0;
  let ignorees = 0;
  let migrationManquante = false;
  const erreurs: string[] = [];
  for (const { organization_id } of (modules ?? []) as { organization_id: string }[]) {
    // Une organisation en erreur n'empêche pas les autres.
    try {
      const bilan = await envoyerSemainesAuto(admin, organization_id, maintenant);
      if (bilan.migrationManquante) migrationManquante = true;
      envoyees += bilan.envoyees;
      rappels += bilan.rappels;
      ignorees += bilan.ignorees;
      for (const e of bilan.erreurs) erreurs.push(`${organization_id} ${e}`);
    } catch (err) {
      erreurs.push(`${organization_id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (erreurs.length) console.error("cron envoi automatique du planning", erreurs);
  return NextResponse.json({ ok: true, organisations: (modules ?? []).length, envoyees, rappels, ignorees, erreurs: erreurs.length, ...(migrationManquante ? { message: "Migration 20261111000001_planning_semaines_auto.sql pas encore appliquée." } : {}) });
}
