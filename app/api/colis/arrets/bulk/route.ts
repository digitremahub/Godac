import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { geocodeAddress, reverseGeocode } from "@/lib/geo/geocode";
import { codePays } from "@/lib/pays/serveur";
import { normaliserTelephone } from "@/lib/colis/telephone";
import { cleAdresse, moduleActif, tourneeParId } from "@/lib/colis/serveur";

const pointSchema = z.object({
  adresse: z.string().trim().max(300).nullable(),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  nom: z.string().trim().max(120).nullable(),
  telephone: z.string().trim().max(40).nullable().optional(),
});
// Géocodage d'une longue liste hors de France (une adresse par seconde).
export const maxDuration = 300;

const bodySchema = z.object({ run_id: z.string().uuid(), points: z.array(pointSchema).min(1).max(200) });

/** Exécute `fn` sur chaque élément, au plus `n` à la fois (géocodage sans saturer l'API). */
async function parLots<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

/**
 * Ajout d'une liste importée (Google Maps, fichier, liste collée) : les
 * adresses sont géocodées, les points sans adresse reçoivent l'adresse la
 * plus proche, et une adresse déjà présente rejoint l'arrêt existant.
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();
  if (!(await moduleActif(supabase, appUser.organization_id))) return NextResponse.json({ error: "Module Tournée colis non activé." }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Liste invalide (200 adresses au plus)." }, { status: 400 });
  const run = await tourneeParId(supabase, appUser, parsed.data.run_id);
  if (!run) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  // Hors de France, OpenStreetMap (Nominatim) demande une requête à la fois.
  const pays = await codePays(appUser.organization_id);
  const complets = await parLots(parsed.data.points, pays === "FR" ? 6 : 1, async (p) => {
    // Nominatim : une requête par seconde au plus (conditions d'utilisation d'OpenStreetMap).
    if (pays !== "FR") await new Promise((r) => setTimeout(r, 1000));
    let { adresse, lat, lng } = p;
    if ((lat === null || lng === null) && adresse) {
      const geo = await geocodeAddress(adresse, pays);
      lat = geo?.lat ?? null;
      lng = geo?.lng ?? null;
    }
    if (!adresse && lat !== null && lng !== null) adresse = (await reverseGeocode(lat, lng, pays)) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return adresse && adresse.length >= 3 ? { adresse, lat, lng, nom: p.nom, telephone: normaliserTelephone(p.telephone) } : null;
  });

  const { data: existants } = await supabase.from("delivery_stops").select("id, address, parcel_count, phone, status, position").eq("run_id", run.id);
  const parCle = new Map((existants ?? []).filter((s) => s.status === "pending").map((s) => [cleAdresse(s.address), s]));
  let position = (existants ?? []).reduce((m, s) => Math.max(m, s.position), -1) + 1;
  const nouveaux = new Map<string, Record<string, unknown>>();
  let regroupes = 0;
  let ignores = 0;

  for (const p of complets) {
    if (!p) {
      ignores++;
      continue;
    }
    const cle = cleAdresse(p.adresse);
    const existant = parCle.get(cle);
    const nouveau = nouveaux.get(cle);
    if (existant) {
      regroupes++;
      existant.parcel_count += 1;
      if (!existant.phone && p.telephone) existant.phone = p.telephone;
      await supabase.from("delivery_stops").update({ parcel_count: existant.parcel_count, phone: existant.phone }).eq("id", existant.id);
    } else if (nouveau) {
      regroupes++;
      nouveau.parcel_count = (nouveau.parcel_count as number) + 1;
      if (!nouveau.phone && p.telephone) nouveau.phone = p.telephone;
    } else {
      nouveaux.set(cle, {
        organization_id: appUser.organization_id,
        run_id: run.id,
        position: position++,
        address: p.adresse,
        recipient: p.nom,
        phone: p.telephone,
        lat: p.lat,
        lng: p.lng,
        parcel_count: 1,
      });
    }
  }

  if (nouveaux.size) {
    const { error } = await supabase.from("delivery_stops").insert([...nouveaux.values()]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const sansGps = [...nouveaux.values()].filter((s) => s.lat === null).length;
  return NextResponse.json({ ajoutes: nouveaux.size, regroupes, ignores, sansGps });
}
