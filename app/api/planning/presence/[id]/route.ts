import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parisCalendarDate, parisWallTimeToUtcISOString } from "@/lib/planning/dates";
import { PRESENCE_STATUS } from "@/lib/organization/poles";

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const patchSchema = z.object({ start: z.string().regex(HEURE), end: z.string().regex(HEURE) });

/**
 * Modifier les horaires d'une présence (même jour) ou la supprimer.
 * Limité aux lignes de présence : une tournée ne passe jamais par ici
 * (voir app/api/planning/entries/[id]). RLS planning_entries en plus.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await garderApi({ modules: ["planning"] });
  if (!g.ok) return g.reponse;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Horaires invalides (format HH:MM)." }, { status: 400 });
  if (parsed.data.end <= parsed.data.start) return NextResponse.json({ error: "L'heure de fin doit être après l'heure d'arrivée." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: entry } = await supabase.from("planning_entries").select("start_at").eq("id", id).eq("status", PRESENCE_STATUS).maybeSingle();
  if (!entry) return NextResponse.json({ error: "Présence introuvable." }, { status: 404 });
  const jour = parisCalendarDate(entry.start_at);

  const { error } = await supabase
    .from("planning_entries")
    .update({ start_at: parisWallTimeToUtcISOString(jour, parsed.data.start), end_at: parisWallTimeToUtcISOString(jour, parsed.data.end) })
    .eq("id", id)
    .eq("status", PRESENCE_STATUS);
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Cette personne a déjà une présence à cette heure-là ce jour-là." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g2 = await garderApi({ modules: ["planning"] });
  if (!g2.ok) return g2.reponse;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("planning_entries").delete().eq("id", id).eq("status", PRESENCE_STATUS).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Présence introuvable." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
