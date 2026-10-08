import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});

/**
 * Stores a browser's PushSubscription right after lib/push/client.ts
 * obtains it. Upserts on endpoint (unique per browser/device) so
 * re-subscribing — e.g. after the user cleared site data — replaces
 * the stale row instead of erroring on the unique constraint. RLS
 * ("push_subscriptions: user manages own") is the only guard needed;
 * no admin client here, unlike most alert-adjacent writes.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      organization_id: appUser.organization_id,
      user_id: appUser.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
    { onConflict: "endpoint" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
