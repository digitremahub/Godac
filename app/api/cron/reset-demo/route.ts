import { NextResponse } from "next/server";
import { seedDemo, teardownDemo } from "@/lib/demo/seed";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Nightly rebuild of « Transports Démo » (vercel.json crons) — same CRON_SECRET check as the other cron routes. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await teardownDemo();
  const organizationId = await seedDemo();
  return NextResponse.json({ ok: true, organizationId });
}
