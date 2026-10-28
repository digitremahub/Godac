import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserAlertesNonRentre, synchroniserAlertesSeuil } from "@/lib/stock/alertes-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Cron QUOTIDIEN (vercel.json : jamais plus fréquent), même contrôle CRON_SECRET que les autres.
 * Pour chaque organisation ayant activé le module Stock : alertes de seuil (créées ou closes
 * selon le stock du jour) et alertes d'unités chargées en tournée non rentrées après la
 * clôture. Ne modifie ni le stock ni le registre ; sans les types d'alerte (migration
 * 20261114000003), le bilan l'indique et rien n'est créé.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.from("organization_modules").select("organization_id").eq("module_key", "stock").eq("enabled", true).limit(2000);
  if (error) return NextResponse.json({ ok: false, error: "organisations illisibles" }, { status: 500 });
  const bilan = { organisations: 0, seuil_creees: 0, seuil_closes: 0, non_rentre_creees: 0, non_rentre_closes: 0, type_absent: false, erreurs: [] as string[] };
  for (const { organization_id } of (data ?? []) as { organization_id: string }[]) {
    bilan.organisations++;
    const [seuil, nonRentre] = [await synchroniserAlertesSeuil(admin, organization_id), await synchroniserAlertesNonRentre(admin, organization_id)];
    bilan.seuil_creees += seuil.creees;
    bilan.seuil_closes += seuil.closes;
    bilan.non_rentre_creees += nonRentre.creees;
    bilan.non_rentre_closes += nonRentre.closes;
    bilan.type_absent ||= seuil.typeAbsent || nonRentre.typeAbsent;
    for (const e of [seuil.erreur, nonRentre.erreur]) if (e) bilan.erreurs.push(e);
  }
  return NextResponse.json({ ok: bilan.erreurs.length === 0, ...bilan });
}
