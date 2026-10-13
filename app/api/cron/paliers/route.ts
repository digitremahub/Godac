import { NextResponse } from "next/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserPaliers } from "@/lib/organization/paliers-serveur";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Recalcul nocturne des paliers d'utilisateurs (vercel.json crons) — même contrôle CRON_SECRET que les autres crons. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, changes: await synchroniserPaliers(createAdminSupabaseClient()) });
}
