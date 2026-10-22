import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { schemaLigneBareme } from "@/lib/ticpe/schema-bareme";

/** Staff GODAC : modifie une ligne du barème (taux, dates, source, « vérifié le »). Jamais de suppression : on clôt une ligne avec sa date de fin. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  const parsed = schemaLigneBareme.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ligne invalide." }, { status: 400 });
  const { data, error } = await createAdminSupabaseClient()
    .from("ticpe_rates")
    .update({ ...parsed.data, updated_by_email: user!.email!.toLowerCase(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Une ligne existe déjà pour cette catégorie, cette zone et cette date de début." : error.message }, { status: error.code === "23505" ? 409 : 500 });
  if (!data) return NextResponse.json({ error: "Ligne introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
