import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { executerFinContrat } from "@/lib/fin-contrat/serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron QUOTIDIEN (vercel.json : le plan Hobby n'autorise qu'une exécution par jour),
 * même contrôle CRON_SECRET que les autres crons. Fin de contrat :
 *  - fin + 60 jours : préavis par e-mail au contact de l'organisation (30 jours avant
 *    la suppression, avec rappel de l'export des données) ;
 *  - fin + 90 jours et préavis envoyé depuis 30 jours au moins : suppression des données
 *    (en gardant le strict nécessaire pour GODAC), sauf si la direction GODAC a bloqué
 *    la suppression (litige) ;
 *  - DRY-RUN tant que FIN_CONTRAT_PURGE_ACTIVE n'est pas « true » : on journalise ce qui
 *    serait fait, sans envoyer ni supprimer. L'action est irréversible.
 * Règles : lib/fin-contrat/regles.ts. Documentation : docs/garde-fous-techniques.md.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const bilan = await executerFinContrat(createAdminSupabaseClient());
  return NextResponse.json({ ok: bilan.erreurs.length === 0, ...bilan });
}
