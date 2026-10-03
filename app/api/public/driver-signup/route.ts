import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createPinDriver } from "@/lib/auth/driver-pin";

const bodySchema = z.object({
  token: z.string().uuid(),
  full_name: z.string().min(1),
  company_name: z.string().min(1),
  phone: z.string().optional(),
  service_id: z.string().uuid().optional(),
});

function normalizeCompanyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Public by necessity — same reasoning as app/api/auth/driver-pin/
 * [id]/set: no session exists yet. The token only ever resolves an
 * organization_id — it carries no more power than that, and the
 * account it creates can't sign in until approved (pending_approval,
 * see lib/auth/session.ts).
 *
 * company_name is a genuine independent check: app/join/[token]/page
 * deliberately never shows the org's real name, so a match here means
 * the driver actually knows (not just read back) who owns this link.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const admin = createAdminSupabaseClient();
  const { data: organization } = await admin
    .from("organizations")
    .select("id, name")
    .eq("driver_signup_token", parsed.data.token)
    .maybeSingle();
  if (!organization) {
    return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  }

  if (normalizeCompanyName(parsed.data.company_name) !== normalizeCompanyName(organization.name)) {
    return NextResponse.json(
      { error: "Le nom d'entreprise indiqué ne correspond pas à celui associé à ce lien. Vérifiez auprès de votre responsable." },
      { status: 422 },
    );
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
