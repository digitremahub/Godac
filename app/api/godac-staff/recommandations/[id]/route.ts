import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { STATUTS_RECOMMANDATION } from "@/lib/recommandation/chaleur";

const bodySchema = z
  .object({
    status: z.enum(STATUTS_RECOMMANDATION).optional(),
    staffNotes: z.string().max(2000).nullable().optional(),
  })
  .refine((b) => b.status !== undefined || b.staffNotes !== undefined, { message: "Rien à modifier." });

/** Staff GODAC : change le statut et/ou les notes internes d'une recommandation d'employeur. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) {
    return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Recommandation introuvable." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Modification invalide (statut inconnu ou notes de plus de 2 000 caractères)." }, { status: 400 });

  const maj: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.data.status !== undefined) maj.status = parsed.data.status;
  if (parsed.data.staffNotes !== undefined) maj.staff_notes = parsed.data.staffNotes?.trim() || null;

  const { data, error } = await createAdminSupabaseClient().from("employer_referrals").update(maj).eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("recommandation employeur (staff)", error.message);
    return NextResponse.json({ error: "Modification impossible." }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Recommandation introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
