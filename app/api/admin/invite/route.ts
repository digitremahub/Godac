import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/clerk/roles";
import { inviteOrganizationMember } from "@/lib/clerk/invitations";

const bodySchema = z.object({
  email: z.string().email(),
  role: z.enum(["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"]),
  service_id: z.string().uuid().optional(),
});

/** Module 9: invite a single user from the admin UI (see also the CSV bulk import in Module 1). */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut inviter des utilisateurs" }, { status: 403 });
  }

  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await inviteOrganizationMember({
      clerkOrgId: orgId,
      email: parsed.data.email,
      role: parsed.data.role,
      serviceId: parsed.data.service_id,
      inviterUserId: userId,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
