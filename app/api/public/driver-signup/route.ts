import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { assignDriverCodeFromBirthDate } from "@/lib/users/driver-code-serveur";
import { dateNaissanceValide } from "@/lib/users/date-naissance";
import { createPinDriver } from "@/lib/auth/driver-pin";
import { organisationParJeton } from "@/lib/organization/lien-inscription";

const bodySchema = z.object({
  token: z.string().uuid(),
  full_name: z.string().min(1),
  company_name: z.string().min(1),
  phone: z.string().optional(),
  // Code de secours « initiales + mois/année de naissance » (ex : FT1188).
  birth_date: z.string().refine((v) => dateNaissanceValide(v), "Date de naissance invalide."),
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
  const organizationId = await organisationParJeton(admin, parsed.data.token);
  const { data: organization } = organizationId
    ? await admin.from("organizations").select("id, name").eq("id", organizationId).maybeSingle()
    : { data: null };
  if (!organization) {
    return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  }

  if (normalizeCompanyName(parsed.data.company_name) !== normalizeCompanyName(organization.name)) {
    return NextResponse.json(
      { error: "Le nom d'entreprise indiqué ne correspond pas à celui associé à ce lien. Vérifiez auprès de votre responsable." },
      { status: 422 },
    );
  }

  // Audit M7 : le service choisi doit appartenir à l'organisation du lien.
  if (parsed.data.service_id) {
    const { data: service } = await admin
      .from("services")
      .select("id")
      .eq("id", parsed.data.service_id)
      .eq("organization_id", organization.id)
      .maybeSingle();
    if (!service) return NextResponse.json({ error: "Service invalide pour ce lien." }, { status: 422 });
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
    await admin.from("employee_files").insert({ organization_id: organization.id, user_id: id, birth_date: parsed.data.birth_date });
    await assignDriverCodeFromBirthDate(admin, organization.id, id, parsed.data.full_name, parsed.data.birth_date);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
