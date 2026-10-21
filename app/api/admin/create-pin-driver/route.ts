import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPinDriver } from "@/lib/auth/driver-pin";
import { creerCodeActivation } from "@/lib/auth/code-activation-serveur";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { peutAttribuerRole } from "@/lib/roles/perimetre";

const bodySchema = z.object({
  full_name: z.string().min(1),
  // Badge + PIN : chauffeur, ou manager qui conduit aussi (can_drive).
  role: z.enum(["chauffeur", "manager"]).default("chauffeur"),
  role_title: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  service_id: z.string().uuid().optional(),
});

/**
 * Lot 7: creates a driver account with no email, for a terrain
 * chauffeur who can't be reached by a magic link. Direction only sets
 * name/role/service here — the driver chooses their own PIN at their
 * first scan of the printed badge (app/driver-pin/[id]).
 *
 * Audit M8 : un badge neuf exige aussi un code d'activation pour le
 * premier PIN (même mécanisme que la réinitialisation,
 * driver_pin_activations) : quelqu'un qui photographie ou intercepte le
 * badge avant sa remise ne peut pas s'approprier le compte. Le code est
 * renvoyé une seule fois, à remettre au chauffeur avec son badge.
 */
export async function POST(req: Request) {
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  // Direction ou exploitation (comptes chauffeur et manager).
  if (appUser.role !== "direction" && appUser.role !== "exploitation") {
    return NextResponse.json({ error: "Seules la direction et l'exploitation peuvent créer un chauffeur sans email" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!peutAttribuerRole(appUser.role, parsed.data.role)) {
    return NextResponse.json({ error: "Rôle non autorisé." }, { status: 403 });
  }
  if (parsed.data.service_id) {
    const { data: service } = await g.supabase.from("services").select("id").eq("id", parsed.data.service_id).eq("organization_id", appUser.organization_id).maybeSingle();
    if (!service) return NextResponse.json({ error: "Service inconnu dans votre organisation." }, { status: 400 });
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
    let activationCode: string | null = null;
    try {
      activationCode = await creerCodeActivation(createAdminSupabaseClient(), { userId: id, organizationId: appUser.organization_id, createdBy: appUser.id });
    } catch (err) {
      // Table absente (migration 20261019000005 non appliquée) : parcours historique, badge seul.
      console.error("create-pin-driver: code d'activation non créé", err);
    }
    return NextResponse.json({ id, activationCode });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
