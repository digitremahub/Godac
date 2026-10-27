import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { surveillerEcheances } from "@/lib/alerts/echeances-serveur";
import { surveillerConsommationReference } from "@/lib/fuel/consommation-reference-serveur";
import { parisDay } from "@/lib/utils/paris-time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron QUOTIDIEN (vercel.json : le plan Hobby n'autorise qu'une exécution par
 * jour), même contrôle CRON_SECRET que les autres crons. Pour chaque
 * organisation qui a le module Flotte ou le module Amendes :
 *  - échéances des papiers des véhicules actifs (contrôle technique, assurance,
 *    licence…) et date limite de paiement minoré des amendes : une alerte à J-30,
 *    J-7 et J0, dédoublonnée par échéance et par palier, destinataires par rôle
 *    et service (manager : ses véhicules ; exploitation et direction :
 *    l'organisation), close quand le document est renouvelé ou l'amende réglée ;
 *  - consommation des 30 derniers jours au-dessus de la référence du véhicule
 *    (alerte douce, une par véhicule et par mois).
 * Les alertes partent en cloche, push et e-mail par le webhook des alertes.
 * Jours : Europe/Paris.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const aujourdhui = parisDay();
  const { data: modules } = await admin.from("organization_modules").select("organization_id, module_key").in("module_key", ["fleet", "fines"]).eq("enabled", true);
  const parOrg = new Map<string, Set<string>>();
  for (const m of (modules ?? []) as { organization_id: string; module_key: string }[]) {
    parOrg.set(m.organization_id, (parOrg.get(m.organization_id) ?? new Set()).add(m.module_key));
  }

  let creees = 0;
  let closes = 0;
  let consommation = 0;
  const erreurs: string[] = [];
  for (const [orgId, cles] of parOrg) {
    // Une organisation en erreur n'empêche pas les autres.
    try {
      const r = await surveillerEcheances(admin, orgId, aujourdhui, { documents: cles.has("fleet"), amendes: cles.has("fines") });
      creees += r.creees;
      closes += r.closes;
    } catch (err) {
      erreurs.push(`${orgId} échéances: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (cles.has("fleet")) {
      try {
        consommation += (await surveillerConsommationReference(admin, orgId, aujourdhui)).creees;
      } catch (err) {
        erreurs.push(`${orgId} consommation: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (erreurs.length) console.error("cron échéances de la flotte", erreurs);
  return NextResponse.json({ ok: true, organisations: parOrg.size, alertes: creees, closes, consommation, erreurs: erreurs.length });
}
