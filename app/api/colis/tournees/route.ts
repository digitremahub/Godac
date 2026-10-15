import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { creerTournee, listerTournees, moduleActif } from "@/lib/colis/serveur";

/** Tournées colis du chauffeur connecté (jour en cours + non clôturées de la semaine). */
export async function GET() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  return NextResponse.json({ tournees: await listerTournees(supabase, appUser) });
}

const bodySchema = z.object({ name: z.string().trim().max(60).nullable().optional() });

/** Nouvelle tournée colis du jour (on peut en faire plusieurs). */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Nom invalide." }, { status: 400 });
  try {
    const run = await creerTournee(supabase, appUser, parsed.data.name ?? null);
    // Les ramasses habituelles sont des arrêts de la tournée, pas un onglet séparé.
    const { data: habitudes, error: erreurHabitudes } = await supabase
      .from("driver_pickup_templates")
      .select("address, recipient, phone")
      .eq("driver_id", appUser.id)
      .eq("organization_id", appUser.organization_id)
      .eq("active", true)
      .order("created_at");
    if (erreurHabitudes && erreurHabitudes.code !== "42P01") throw erreurHabitudes;
    if (habitudes?.length) {
      const pays = await codePays(appUser.organization_id);
      for (const [index, habitude] of habitudes.entries()) {
        const geo = await geocodeAddress(habitude.address, pays).catch(() => null);
        const { error } = await supabase.from("delivery_stops").insert({
          organization_id: appUser.organization_id,
          run_id: run.id,
          position: index,
          kind: "ramasse",
          address: habitude.address,
          recipient: habitude.recipient,
          phone: habitude.phone,
          parcel_count: 1,
          status: "pending",
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
        });
        if (error) throw new Error(`Tournée créée, mais une ramasse habituelle n’a pas pu être ajoutée : ${error.message}`);
      }
    }
    return NextResponse.json({ run });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Création impossible" }, { status: 500 });
  }
}
