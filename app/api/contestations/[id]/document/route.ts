import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Lien temporaire (5 min) vers le document de la contestation — encadrement uniquement. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["customer_disputes"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  if (!hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])) return NextResponse.json({ error: "Réservé à l'encadrement." }, { status: 403 });
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: c } = await supabase.from("customer_disputes").select("document_path").eq("id", id).maybeSingle();
  if (!c?.document_path) return NextResponse.json({ error: "Aucun document." }, { status: 404 });
  const { data } = await supabase.storage.from("dispute-docs").createSignedUrl(c.document_path, 300);
  if (!data?.signedUrl) return NextResponse.json({ error: "Document indisponible." }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
