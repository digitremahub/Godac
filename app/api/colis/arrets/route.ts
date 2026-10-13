import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { cleAdresse, moduleActif, tourneeParId, STOP_FIELDS } from "@/lib/colis/serveur";

const bodySchema = z.object({
  run_id: z.string().uuid(),
  code: z.string().trim().max(120).nullable().optional(),
  adresse: z.string().trim().min(5).max(300),
  destinataire: z.string().trim().max(120).nullable().optional(),
  telephone: z.string().trim().max(40).nullable().optional(),
});

/**
 * Ajoute un colis à la tournée du jour. Un colis déjà scanné est ignoré ;
 * un colis pour une adresse déjà présente rejoint cet arrêt (compteur de
 * colis) au lieu de créer un arrêt en double.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Adresse manquante ou trop courte." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  const { data: stops } = await supabase.from("delivery_stops").select("id, parcel_code, parcel_count, address, phone, status, position").eq("run_id", run.id);
  const code = parsed.data.code || null;
  const telephone = normaliserTelephone(parsed.data.telephone);
  if (code && (stops ?? []).some((s) => s.parcel_code?.split(",").includes(code))) {
    return NextResponse.json({ duplicate: true, message: "Colis déjà dans la tournée." });
  }

  const cle = cleAdresse(parsed.data.adresse);
  const memeAdresse = (stops ?? []).find((s) => s.status === "pending" && cleAdresse(s.address) === cle);
  if (memeAdresse) {
    const codes = [memeAdresse.parcel_code, code].filter(Boolean).join(",") || null;
    const { data } = await supabase
      .from("delivery_stops")
      .update({ parcel_count: memeAdresse.parcel_count + 1, parcel_code: codes, ...(telephone && !memeAdresse.phone ? { phone: telephone } : {}) })
      .eq("id", memeAdresse.id)
      .select(STOP_FIELDS)
      .single();
    return NextResponse.json({ stop: data, grouped: true });
  }

  const geo = await geocodeAddress(parsed.data.adresse);
  const position = (stops ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const { data, error } = await supabase
    .from("delivery_stops")
    .insert({
      organization_id: appUser.organization_id,
      run_id: run.id,
      position,
      parcel_code: code,
      address: parsed.data.adresse,
      recipient: parsed.data.destinataire || null,
      phone: telephone,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    })
    .select(STOP_FIELDS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ stop: data, geocoded: Boolean(geo) });
}
