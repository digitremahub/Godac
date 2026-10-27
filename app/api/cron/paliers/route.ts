import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserPaliers } from "@/lib/organization/paliers-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recalcul nocturne des paliers d'utilisateurs (vercel.json crons) — même contrôle CRON_SECRET que les autres crons. Reprend aussi les mises à jour Stripe restées en échec. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const changes = await synchroniserPaliers(createAdminSupabaseClient());
    // Une mise à jour Stripe en échec n'a pas modifié la base : elle est reprise au prochain passage (et tracée au journal d'audit).
    return NextResponse.json({ ok: true, changes, echecsStripe: changes.filter((c) => c.echecStripe).length });
  } catch (e) {
    console.error("cron paliers", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erreur" }, { status: 500 });
  }
}
