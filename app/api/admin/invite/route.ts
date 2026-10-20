import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { inviteOrganizationMember } from "@/lib/auth/invitations";
import { blockInDemo } from "@/lib/demo/guard";

const bodySchema = z.object({
  email: z.string().email(),
  full_name: z.string().min(1).optional(),
  role: z.enum(["chauffeur", "manager", "comptable", "direction"]),
  role_title: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  service_id: z.string().uuid().optional(),
});

/** Module 9: invite a single user from the admin UI (see also the CSV bulk import in Module 1). */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut inviter des utilisateurs" }, { status: 403 });
  }
  const demoBlocked = await blockInDemo(appUser.organization_id);
  if (demoBlocked) return demoBlocked;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
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
