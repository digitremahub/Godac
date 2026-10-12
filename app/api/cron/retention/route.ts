import { NextResponse } from "next/server";
import { purgeExpiredData } from "@/lib/retention/purge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nightly enforcement of the retention periods (vercel.json crons) — same CRON_SECRET check as the other cron routes. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, purged: await purgeExpiredData() });
}
