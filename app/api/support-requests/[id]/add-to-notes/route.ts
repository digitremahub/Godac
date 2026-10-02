import { NextResponse } from "next/server";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** "Ajouter cette réponse aux consignes" — direction only, per spec. RLS ("assistant_notes: direction manages") backs this too. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appUser = await requireAppUser();
  if (appUser.role !== "direction") {
    return NextResponse.json({ error: "Seule la direction peut ajouter une consigne." }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: request, error: fetchError } = await supabase
    .from("support_requests")
    .select("question, response, status")
    .eq("id", id)
    .single();
  if (fetchError || !request) {
    return NextResponse.json({ error: "Demande introuvable." }, { status: 404 });
  }
  if (!request.response) {
    return NextResponse.json({ error: "Cette demande n'a pas encore de réponse." }, { status: 409 });
  }

  const { error } = await supabase.from("assistant_notes").insert({
    organization_id: appUser.organization_id,
    title: request.question.slice(0, 120),
    content: request.response,
    roles: [],
    created_by: appUser.id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
