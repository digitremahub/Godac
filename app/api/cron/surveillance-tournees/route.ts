import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { surveillerPlanning, surveillerRetards } from "@/lib/exploitation/surveillance-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron quotidien (vercel.json : le plan Hobby n'autorise qu'une exécution par jour ; une fréquence plus fine demande le plan Pro ou un déclencheur externe), même contrôle CRON_SECRET que
 * les autres crons. Surveille les tournées sans que personne n'ouvre un
 * écran, pour chaque organisation qui a le module Tournée colis ou le
 * module Planning :
 *  - retards des tournées colis en cours (module Tournée colis) ;
 *  - tournées du planning non démarrées ou sans chauffeur, aujourd'hui et
 *    demain (module Planning).
 * Les alertes créées (une par tournée, dédoublonnées) partent en cloche,
 * push et e-mail par le webhook des alertes ; celles dont la condition a
 * disparu sont closes. Jours et heures : Europe/Paris.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const admin = createAdminSupabaseClient();
  const maintenant = new Date();
  const { data: modules } = await admin.from("organization_modules").select("organization_id, module_key").in("module_key", ["route_optimizer", "planning"]).eq("enabled", true);
  const parOrg = new Map<string, Set<string>>();
  for (const m of (modules ?? []) as { organization_id: string; module_key: string }[]) {
    parOrg.set(m.organization_id, (parOrg.get(m.organization_id) ?? new Set()).add(m.module_key));
  }

  let alertes = 0;
  let closes = 0;
  const erreurs: string[] = [];
  for (const [orgId, cles] of parOrg) {
    // Une organisation en erreur n'empêche pas les autres.
    if (cles.has("route_optimizer")) {
      try {
        const r = await surveillerRetards(admin, orgId, maintenant);
        alertes += r.creees;
        closes += r.closes;
      } catch (err) {
        erreurs.push(`${orgId} retards: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (cles.has("planning")) {
      try {
        const r = await surveillerPlanning(admin, orgId, maintenant);
        alertes += r.creees;
        closes += r.closes;
      } catch (err) {
        erreurs.push(`${orgId} planning: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  if (erreurs.length) console.error("cron surveillance des tournées", erreurs);
  return NextResponse.json({ ok: true, organisations: parOrg.size, alertes, closes, erreurs: erreurs.length });
}
