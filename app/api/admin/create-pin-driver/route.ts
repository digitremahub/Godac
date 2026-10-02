import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createPinDriver } from "@/lib/auth/driver-pin";

const bodySchema = z.object({
  full_name: z.string().min(1),
  role: z.enum(["chauffeur", "manager_chauffeur"]),
  role_title: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  service_id: z.string().uuid().optional(),
});

/**
 * Lot 7: creates a driver account with no email, for a terrain
 * chauffeur who can't be reached by a magic link. Direction only sets
 * name/role/service here — the driver chooses their own PIN at their
 * first scan of the printed badge (app/driver-pin/[id]).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut créer un chauffeur sans email" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { id } = await createPinDriver({
      fullName: parsed.data.full_name,
      role: parsed.data.role,
      roleTitle: parsed.data.role_title,
      phone: parsed.data.phone,
      organizationId: appUser.organization_id,
      serviceId: parsed.data.service_id,
    });
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
