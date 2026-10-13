import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { resolveTourActor } from "@/lib/tours/on-behalf";
import { getCurrentTankPmp } from "@/lib/fuel/current-pmp";
import { checkOdometerJump, checkOdometerNotRegressing } from "@/lib/business/odometer";
import { getVehicleLatestKmReading } from "@/lib/vehicles/odometer-reference";

const bodySchema = z.object({
  vehicle_id: z.string().uuid(),
  // Absent pour un achat en station : le plein n'est rattaché à aucune cuve.
  tank_id: z.string().uuid().optional(),
  driver_id: z.string().uuid().optional(), // manager filling in on behalf of a driver
  occurred_at: z.string().datetime(),
  totalizer_before: z.coerce.number().nonnegative().nullable().optional(),
  totalizer_after: z.coerce.number().positive().optional(),
  totalizer_before_photo_path: z.string().optional(),
  totalizer_after_photo_path: z.string().optional(),
  vehicle_km: z.coerce.number().nonnegative().optional(),
  vehicle_km_photo_path: z.string().optional(),
  // Plein cuve : déduits du totaliseur et du PMP. Achat en station : obligatoires.
  liters: z.coerce.number().positive().max(5000).optional(),
  unit_price: z.coerce.number().positive().max(10).optional(),
  product: z.enum(["gazole", "adblue"]).optional(),
  station_name: z.string().optional(),
});

/** Tolérance au-delà de la capacité du réservoir (jauge, mousse). */
const MARGE_RESERVOIR = 1.1;

/**
 * Module 2: saisie d'un plein, deux cas :
 * - plein à la cuve de l'entreprise : le chauffeur relève le totaliseur
 *   avant/après ; litres = après − avant, prix = PMP courant de la cuve
 *   (lib/fuel/current-pmp.ts), jamais demandé au chauffeur ;
 * - achat en station (tank_id absent) : litres, prix au litre et produit
 *   du ticket, sans cuve ni totaliseur.
 * Contrôles : litres plausibles pour le réservoir du véhicule, kilométrage
 * ni en recul ni en saut absurde. Stock, PMP, écarts et alertes sont
 * calculés par les triggers (migration 121).
 */
export async function POST(req: Request) {
  const appUser = await requireAppUser();
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const d = parsed.data;
  const station = !d.tank_id;

  // « J'entre le ravitaillement d'un collègue »: with a valid on-behalf
  // token (badge + PIN checked in /api/tours/on-behalf) the entry is
  // the colleague's, inserted through the service-role client — so the
  // vehicle and tank are checked against the organization explicitly.
  const actor = await resolveTourActor(req, appUser);
  if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: actor.status });
  const { db: supabase, helperId } = actor;
  const driverId = helperId ? actor.driverId : d.driver_id ?? appUser.id;

  const [{ data: vehicle }, { data: tank }] = await Promise.all([
    supabase.from("vehicles").select("id, tank_capacity_liters, adblue_capacity_liters").eq("id", d.vehicle_id).eq("organization_id", appUser.organization_id).maybeSingle(),
    d.tank_id
      ? supabase.from("tanks").select("id, fuel_type").eq("id", d.tank_id).eq("organization_id", appUser.organization_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!vehicle || (d.tank_id && !tank)) return NextResponse.json({ error: "Véhicule ou cuve introuvable." }, { status: 404 });

  if (new Date(d.occurred_at).getTime() > Date.now() + 10 * 60_000) {
    return NextResponse.json({ error: "La date du plein est dans le futur." }, { status: 422 });
  }

  let liters = d.liters;
  let totalizerBefore = d.totalizer_before ?? null;
  let unitPrice = d.unit_price;
  const product = tank ? (tank.fuel_type === "adblue" ? "adblue" : "gazole") : d.product ?? "gazole";

  if (station) {
    if (liters === undefined || unitPrice === undefined) {
      return NextResponse.json({ error: "Achat en station : indiquez les litres et le prix au litre du ticket." }, { status: 422 });
    }
  } else {
    if (d.totalizer_after === undefined) {
      return NextResponse.json({ error: "Plein à la cuve : indiquez l'index du totaliseur après le plein." }, { status: 422 });
    }
    if (liters === undefined) {
      if (totalizerBefore === null) {
        return NextResponse.json({ error: "Indiquez le litrage ou l'index du compteur avant le plein pour le déduire." }, { status: 422 });
      }
      liters = Math.round((d.totalizer_after - totalizerBefore) * 100) / 100;
      if (liters <= 0) {
        return NextResponse.json({ error: "L'index après le plein doit être supérieur à l'index avant." }, { status: 422 });
      }
    } else if (totalizerBefore === null) {
      // Index avant non relevé : déduit des litres, pour que l'écart avec le plein précédent reste contrôlé.
      totalizerBefore = Math.round((d.totalizer_after - liters) * 100) / 100;
    }
    if (unitPrice === undefined) {
      const currentPmp = await getCurrentTankPmp(supabase, d.tank_id!);
      if (currentPmp === null) {
        return NextResponse.json(
          { error: "Prix de la cuve inconnu : enregistrez une livraison avec son prix au litre, ou indiquez le prix." },
          { status: 422 },
        );
      }
      unitPrice = currentPmp;
    }
  }

  const capacite = Number(product === "adblue" ? vehicle.adblue_capacity_liters : vehicle.tank_capacity_liters) || null;
  if (capacite && liters > capacite * MARGE_RESERVOIR) {
    return NextResponse.json(
      { error: `${liters} L dépasse la capacité du réservoir ${product === "adblue" ? "AdBlue " : ""}du véhicule (${capacite} L). Vérifiez la saisie.` },
      { status: 422 },
    );
  }

  if (d.vehicle_km !== undefined) {
    const dernier = await getVehicleLatestKmReading(supabase, d.vehicle_id);
    const recul = checkOdometerNotRegressing(d.vehicle_km, dernier?.km ?? null, `la dernière lecture (${dernier?.source ?? "véhicule"})`);
    if (!recul.ok) return NextResponse.json({ error: recul.message }, { status: 422 });
    const saut = checkOdometerJump(d.vehicle_km, dernier?.km ?? null, dernier?.at ?? null);
    if (!saut.ok) return NextResponse.json({ error: saut.message }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("fuel_entries")
    .insert({
      organization_id: appUser.organization_id,
      vehicle_id: d.vehicle_id,
      tank_id: d.tank_id ?? null,
      driver_id: driverId,
      created_by: appUser.id,
      occurred_at: d.occurred_at,
      totalizer_before: station ? null : totalizerBefore,
      totalizer_after: station ? null : d.totalizer_after,
      totalizer_before_photo_path: station ? undefined : d.totalizer_before_photo_path,
      totalizer_after_photo_path: station ? undefined : d.totalizer_after_photo_path,
      vehicle_km: d.vehicle_km ?? null,
      vehicle_km_photo_path: d.vehicle_km_photo_path,
      liters,
      unit_price: unitPrice,
      product,
      station_name: d.station_name,
      status: "manual",
    })
    .select("id, gap_flagged, totalizer_gap, pmp_at_entry")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ fuelEntry: data });
}
