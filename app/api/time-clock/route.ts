import { garderApi } from "@/lib/acces/garde-api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { entreeAClore } from "@/lib/time-clock/regularisation";
import { cloturerPointagesOuverts } from "@/lib/time-clock/regularisation-serveur";

const bodySchema = z.object({
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

/**
 * Toggles the caller's own clock state — one open entry
 * (clocked_out_at is null) at a time. The captured coordinates (browser
 * geolocation, best-effort — never blocks the badge if denied/unavailable)
 * let direction cross-check a badge against the depot or the driver's home
 * (lib/time-clock/classify-location.ts). The entries feed the payroll hours
 * (lib/paie/heures.ts).
 *
 * Sortie oubliée : une entrée ouverte depuis plus de 16 h ou d'un jour
 * précédent n'est jamais fermée par ce badgeage (le bouton s'inverserait et la
 * durée serait absurde) : elle est close avec une sortie estimée, « à
 * régulariser » (lib/time-clock/regularisation.ts), puis une NOUVELLE entrée est
 * ouverte. La même clôture est faite chaque nuit par le cron rh-quotidien.
 */
export async function POST(req: Request) {
  const g = await garderApi({ modules: ["time_clock"] });
  if (!g.ok) return g.reponse;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();

  const timeClockEnabled = await isModuleEnabled(supabase, appUser.organization_id, "time_clock");
  if (!timeClockEnabled) {
    return NextResponse.json({ error: "Module Pointeuse non activé." }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const latitude = parsed.success ? parsed.data.latitude : undefined;
  const longitude = parsed.success ? parsed.data.longitude : undefined;

  // Plusieurs entrées ouvertes (avant l'index unique, audit M1) : on ferme
  // la plus récente au lieu d'échouer silencieusement.
  const { data: ouvertes, error: openError } = await supabase
    .from("time_clock_entries")
    .select("id, clocked_in_at")
    .eq("user_id", appUser.id)
    .is("clocked_out_at", null)
    .order("clocked_in_at", { ascending: false })
    .limit(1);
  if (openError) return NextResponse.json({ error: openError.message }, { status: 500 });
  let open = ouvertes?.[0] ?? null;
  if (open && entreeAClore(open.clocked_in_at, new Date())) {
    // Client service, borné à cette personne : le trigger du pointage refuse à un utilisateur une sortie loin de maintenant.
    const bilan = await cloturerPointagesOuverts(createAdminSupabaseClient(), appUser.organization_id, new Date(), appUser.id).catch(() => null);
    if (bilan && bilan.closes > 0) open = null;
  }

  if (open) {
    const { error } = await supabase
      .from("time_clock_entries")
      .update({
        clocked_out_at: new Date().toISOString(),
        clock_out_lat: latitude ?? null,
        clock_out_lng: longitude ?? null,
      })
      .eq("id", open.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "clocked_out" });
  }

  const { error } = await supabase.from("time_clock_entries").insert({
    organization_id: appUser.organization_id,
    user_id: appUser.id,
    clock_in_lat: latitude ?? null,
    clock_in_lng: longitude ?? null,
  });
  // Double tap : l'index unique « une entrée ouverte par utilisateur » refuse la seconde.
  if (error?.code === "23505") return NextResponse.json({ status: "clocked_in" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "clocked_in" });
}
