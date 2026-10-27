import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { journaliser } from "@/lib/audit/journal";
import { surveillerEcheancesRh } from "@/lib/alerts/echeances-rh-serveur";
import { cloturerPointagesOuverts } from "@/lib/time-clock/regularisation-serveur";
import { parisDay } from "@/lib/utils/paris-time";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron QUOTIDIEN (vercel.json : le plan Hobby n'autorise qu'une exécution par
 * jour), même contrôle CRON_SECRET que les autres crons. Pour chaque
 * organisation :
 *  - module Pointeuse : clôture des pointages restés ouverts depuis plus de 16 h
 *    ou d'un jour précédent, avec une sortie estimée « à régulariser » (fin
 *    planifiée, sinon entrée + durée prévue, sinon à saisir) et une alerte à
 *    l'encadrement du service. Sans cela, le bouton du lendemain s'inverserait ;
 *  - module Dossiers salariés : échéances RH (permis, visite médicale, fin de
 *    contrat, documents datés) à J-60, J-30, J-7 et J0, dédoublonnées par
 *    échéance et par palier, closes quand le document est renouvelé.
 * Les alertes partent en cloche, push et e-mail par le webhook des alertes.
 * Jours : Europe/Paris.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const maintenant = new Date();
  const aujourdhui = parisDay(maintenant);
  const { data: modules } = await admin.from("organization_modules").select("organization_id, module_key").in("module_key", ["time_clock", "employee_files"]).eq("enabled", true);
  const parOrg = new Map<string, Set<string>>();
  for (const m of (modules ?? []) as { organization_id: string; module_key: string }[]) {
    parOrg.set(m.organization_id, (parOrg.get(m.organization_id) ?? new Set()).add(m.module_key));
  }

  let pointagesCloses = 0;
  let alertesCreees = 0;
  let alertesCloses = 0;
  const erreurs: string[] = [];
  for (const [orgId, cles] of parOrg) {
    // Une organisation en erreur n'empêche pas les autres.
    if (cles.has("time_clock")) {
      try {
        const bilan = await cloturerPointagesOuverts(admin, orgId, maintenant);
        pointagesCloses += bilan.closes;
        if (bilan.closes > 0) {
          await journaliser({ organizationId: orgId, userId: null, action: "pointage_cloture_auto", targetTable: "time_clock_entries", details: { clotures: bilan.closes, jour: aujourdhui } });
        }
      } catch (err) {
        erreurs.push(`${orgId} pointages: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (cles.has("employee_files")) {
      try {
        const r = await surveillerEcheancesRh(admin, orgId, aujourdhui);
        alertesCreees += r.creees;
        alertesCloses += r.closes;
      } catch (err) {
        erreurs.push(`${orgId} échéances RH: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (erreurs.length) console.error("cron RH quotidien", erreurs);
  return NextResponse.json({ ok: true, organisations: parOrg.size, pointagesCloses, alertes: alertesCreees, closes: alertesCloses, erreurs: erreurs.length });
}
