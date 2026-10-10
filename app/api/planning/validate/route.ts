import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { addDays } from "@/lib/planning/dates";

const bodySchema = z.object({
  service_id: z.string().uuid(),
  week_start: z.string().date(),
});

interface DigestEntry {
  driver_id: string | null;
  tour_number: string;
  start_at: string;
  vehicles: { registration: string } | null;
}

function buildDigestMessage(entries: DigestEntry[]): string {
  const lines = entries.map((e) => {
    const d = new Date(e.start_at);
    const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
    return `${day} ${time} — n°${e.tour_number}${e.vehicles ? ` (${e.vehicles.registration})` : ""}`;
  });
  return `Votre planning de la semaine a été validé :\n${lines.join("\n")}`;
}

/**
 * "Valider et envoyer" — tant qu'une semaine/service n'a pas de ligne
 * dans planning_validations, after_planning_entry_upsert
 * (20260101000071) reste silencieux pendant que le chef de service
 * construit le planning. Ce POST pose la ligne de validation puis
 * envoie un récapitulatif groupé à chaque chauffeur concerné ; toute
 * modif après ce point retombe sur la notification immédiate par
 * tournée habituelle (gérée par le trigger lui-même, rien à faire ici).
 *
 * L'upsert passe par le client lié à la session (RLS scope la
 * validation au service du manager) ; l'envoi des alertes utilise le
 * client admin car alerts n'a pas de policy d'insert pour les clients
 * authentifiés (seuls les triggers security-definer et les crons
 * service-role y écrivent, voir 20260101000030 et
 * app/api/cron/weekly-planning-digest) — le rôle a déjà été vérifié
 * au-dessus.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "manager" && appUser.role !== "direction") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { service_id, week_start } = parsed.data;
  const weekEnd = addDays(week_start, 7);

  const supabase = await createServerSupabaseClient();
  const { error: upsertError } = await supabase.from("planning_validations").upsert(
    {
      organization_id: appUser.organization_id,
      service_id,
      week_start,
      validated_at: new Date().toISOString(),
      validated_by: appUser.id,
    },
    { onConflict: "organization_id,service_id,week_start" },
  );
  if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });

  const { data: entries, error: entriesError } = await supabase
    .from("planning_entries")
    .select("driver_id, tour_number, start_at, vehicles(registration)")
    .eq("service_id", service_id)
    .eq("status", "planned")
    .not("driver_id", "is", null)
    .gte("start_at", `${week_start}T00:00:00`)
    .lt("start_at", `${weekEnd}T00:00:00`)
    .order("start_at");
  if (entriesError) return NextResponse.json({ error: entriesError.message }, { status: 500 });

  const byDriver = new Map<string, DigestEntry[]>();
  for (const e of (entries ?? []) as unknown as DigestEntry[]) {
    if (!e.driver_id) continue;
    byDriver.set(e.driver_id, [...(byDriver.get(e.driver_id) ?? []), e]);
  }

  if (byDriver.size > 0) {
    const admin = createAdminSupabaseClient();
    const rows = Array.from(byDriver.entries()).map(([driverId, driverEntries]) => ({
      organization_id: appUser.organization_id,
      type: "planning_validated",
      severity: "info",
      message: buildDigestMessage(driverEntries),
      related_table: "planning_entries",
      recipient_user_id: driverId,
    }));
    const { error: insertError } = await admin.from("alerts").insert(rows);
    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ sent: byDriver.size });
}
