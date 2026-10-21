import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inviteOrganizationMember } from "@/lib/auth/invitations";
import { blockInDemo } from "@/lib/demo/guard";
import { peutAttribuerRole } from "@/lib/roles/perimetre";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).optional(),
  role: z.enum(["chauffeur", "manager", "exploitation", "comptable", "direction"]),
  role_title: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  service_id: z.string().uuid().optional(),
});

/** Module 9: invite a single user from the admin UI (see also the CSV bulk import in Module 1). */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  // Direction : tous les rôles ; exploitation : chauffeur et manager seulement.
  if (appUser.role !== "direction" && appUser.role !== "exploitation") {
    return NextResponse.json({ error: "Seules la direction et l'exploitation peuvent inviter des utilisateurs" }, { status: 403 });
  }
  const demoBlocked = await blockInDemo(appUser.organization_id);
  if (demoBlocked) return demoBlocked;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!peutAttribuerRole(appUser.role, parsed.data.role)) {
    return NextResponse.json({ error: "Seule la direction peut attribuer les rôles direction, comptable et exploitation." }, { status: 403 });
  }
  if (parsed.data.service_id) {
    const { data: service } = await g.supabase.from("services").select("id").eq("id", parsed.data.service_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!service) return NextResponse.json({ error: "Service inconnu dans votre organisation." }, { status: 400 });
  }

  try {
    await inviteOrganizationMember({
      email: parsed.data.email,
      fullName: parsed.data.full_name,
      role: parsed.data.role,
      roleTitle: parsed.data.role_title,
      phone: parsed.data.phone,
      organizationId: appUser.organization_id,
      serviceId: parsed.data.service_id,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
