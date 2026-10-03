import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createPinDriver } from "@/lib/auth/driver-pin";

const bodySchema = z.object({
  token: z.string().uuid(),
  full_name: z.string().min(1),
  phone: z.string().optional(),
  service_id: z.string().uuid().optional(),
});

/**
 * Public by necessity — same reasoning as app/api/auth/driver-pin/
 * [id]/set: no session exists yet. The token only ever resolves an
 * organization_id (app/join/[token]/page.tsx already showed the same
 * lookup's result to the driver before this call) — it carries no
 * more power than that, and the account it creates can't sign in
 * until approved (pending_approval, see lib/auth/session.ts).
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: organization } = await admin
    .from("organizations")
    .select("id")
    .eq("driver_signup_token", parsed.data.token)
    .maybeSingle();
  if (!organization) {
    return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  }

  try {
    const { id } = await createPinDriver({
      fullName: parsed.data.full_name,
      role: "chauffeur",
      phone: parsed.data.phone,
      organizationId: organization.id,
      serviceId: parsed.data.service_id,
      pendingApproval: true,
    });
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
