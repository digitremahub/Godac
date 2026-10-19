import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { moduleActif } from "@/lib/colis/serveur";

const schema = z.object({
  event_type: z.enum(["sms_prepared", "sms_confirmed_sent", "call_started", "call_confirmed", "note"]),
  details: z.string().trim().max(500).nullable().optional(),
});

/** Historique chronologique d'un arrêt de livraison. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await garderApi({ modules: ["route_optimizer"] });
  if (!g.ok) return g.reponse;
  const user = g.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const { id } = await params;
  const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, organization_id").eq("id", id).eq("organization_id", user.organization_id).maybeSingle();
  if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  const { data, error } = await supabase.from("delivery_stop_events")
    .select("id, event_type, previous_value, new_value, details, created_at, actor_id")
    .eq("stop_id", id).eq("organization_id", user.organization_id).order("created_at", { ascending: false }).limit(100);
  // Historique indisponible (table absente tant que la migration n'est pas
  // appliquée) : liste vide plutôt qu'une erreur à chaque ouverture.
  if (error) {
    console.error("delivery_stop_events (lecture)", error.message);
    return NextResponse.json({ events: [], indisponible: true });
  }
  return NextResponse.json({ events: data ?? [] });
}

/** Journalise une action de contact confirmée par le chauffeur. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g2 = await garderApi({ modules: ["route_optimizer"] });
  if (!g2.ok) return g2.reponse;
  const user = g2.appUser;
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, user.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Action invalide." }, { status: 400 });
  const { id } = await params;
  const { data: stop } = await supabase.from("delivery_stops").select("id, run_id, organization_id, phone").eq("id", id).eq("organization_id", user.organization_id).maybeSingle();
  if (!stop) return NextResponse.json({ error: "Arrêt introuvable." }, { status: 404 });
  if (["sms_prepared", "sms_confirmed_sent", "call_started", "call_confirmed"].includes(parsed.data.event_type) && !stop.phone) {
    return NextResponse.json({ error: "Aucun numéro de téléphone pour cet arrêt." }, { status: 400 });
  }
  const labels: Record<string, string> = {
    sms_prepared: "Application SMS ouverte / message préparé",
    sms_confirmed_sent: "Envoi du SMS confirmé par le chauffeur",
    call_started: "Appel lancé",
    call_confirmed: "Appel effectué confirmé par le chauffeur",
    note: "Note ajoutée",
  };
  const { data, error } = await supabase.from("delivery_stop_events").insert({
    organization_id: user.organization_id,
    run_id: stop.run_id,
    stop_id: stop.id,
    actor_id: user.id,
    event_type: parsed.data.event_type,
    details: parsed.data.details || labels[parsed.data.event_type],
  }).select("id, event_type, previous_value, new_value, details, created_at, actor_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}
