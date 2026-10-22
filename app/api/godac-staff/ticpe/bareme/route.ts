import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { isGodacStaffEmail } from "@/lib/godac-staff/auth";
import { schemaLigneBareme } from "@/lib/ticpe/schema-bareme";

/** Staff GODAC : ajoute une ligne au barème TICPE global (service role, RLS sans écriture client). */
export async function POST(req: Request) {
  const userClient = await createServerSupabaseClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!isGodacStaffEmail(user?.email)) return NextResponse.json({ error: "Accès réservé au personnel GODAC" }, { status: 403 });
  const parsed = schemaLigneBareme.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Ligne invalide." }, { status: 400 });
  const { data, error } = await createAdminSupabaseClient()
    .from("ticpe_rates")
    .insert({ ...parsed.data, updated_by_email: user!.email!.toLowerCase() })
    .select("id")
    .single();
  if (error) {
    const doublon = error.code === "23505";
    return NextResponse.json({ error: doublon ? "Une ligne existe déjà pour cette catégorie, cette zone et cette date de début." : error.message }, { status: doublon ? 409 : 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
