import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { peutChangerStatutAlerte } from "@/lib/alerts/destinataires";

const bodySchema = z.object({ status: z.enum(["acknowledged", "resolved"]) });

/**
 * Prend en compte ou résout une alerte (statut partagé). Revérifié côté
 * serveur en plus de la RLS : le chauffeur et le comptable ne résolvent
 * jamais une alerte (ils prennent seulement en compte leurs alertes
 * personnelles) ; le manager ne traite que les alertes de ses services.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ roles: "tous" });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createServerSupabaseClient();
  // Lecture sous la RLS : une alerte hors périmètre est introuvable.
  const { data: alerte } = await supabase.from("alerts").select("id, type, service_id, recipient_user_id").eq("id", id).maybeSingle();
  if (!alerte) return NextResponse.json({ error: "Notification introuvable." }, { status: 404 });
  const { data: liens } = appUser.role === "manager" ? await supabase.from("user_services").select("service_id").eq("user_id", appUser.id) : { data: [] };
  const verdict = peutChangerStatutAlerte({
    role: appUser.role,
    userId: appUser.id,
    statut: parsed.data.status,
    alerte: alerte as { type: string; service_id: string | null; recipient_user_id: string | null },
    mesServices: ((liens ?? []) as { service_id: string }[]).map((l) => l.service_id),
  });
  if (!verdict.ok) return NextResponse.json({ error: verdict.raison }, { status: 403 });

  const { data, error } = await supabase
    .from("alerts")
    .update({
      status: parsed.data.status,
      acknowledged_by: appUser.id,
      acknowledged_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Cette notification n'est pas dans votre périmètre." }, { status: 403 });
  return NextResponse.json({ alert: data });
}
