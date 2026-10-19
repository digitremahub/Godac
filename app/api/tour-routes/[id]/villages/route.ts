import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { normalizeVillageName } from "@/lib/tours/carte-villages";
import { peutGererTournees } from "@/lib/tours/acces-tournees";

const bodySchema = z.object({
  villages: z
    .array(
      z.object({
        /** Village existant : il garde son identifiant (et donc les renforts qui le couvrent). */
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        postal_code: z.string().trim().max(10).nullable().optional(),
        notes: z.string().trim().max(2000).nullable().optional(),
        pickup_addresses: z.array(z.string().trim().min(1).max(300)).max(100).optional(),
        planned_stops: z.array(z.object({
          id: z.string().optional(),
          type: z.enum(["ramasse", "point_relais"]),
          name: z.string().trim().max(200).optional(),
          address: z.string().trim().max(300),
          time_window: z.string().trim().max(40).optional(),
          notes: z.string().trim().max(1000).optional(),
        })).max(200).optional(),
      }),
    )
    .max(200),
});

const NO_GEO = { lat: null, lng: null, insee_code: null, geocode_status: null, geocoded_at: null };

/**
 * Enregistre la liste ordonnée des villages d'une tournée en une fois —
 * l'éditeur envoie toute la liste. Les villages existants sont mis à jour
 * sur place (leur identifiant ne change pas : les tournées de renfort qui
 * les couvrent restent liées), les nouveaux ajoutés, les retirés supprimés.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await requireAppUser();
  if (!peutGererTournees(appUser.role)) {
    return NextResponse.json({ error: "Réservé à la direction et aux chefs d'équipe." }, { status: 403 });
  }
  const { id } = await params;
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Chaque village doit avoir un nom." }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: route } = await supabase.from("tour_routes").select("id").eq("id", id).maybeSingle();
  if (!route) return NextResponse.json({ error: "Tournée introuvable." }, { status: 404 });

  // Les coordonnées déjà trouvées pour la carte suivent le village tant que
  // son nom et son code postal ne changent pas. Sans la migration des
  // coordonnées, la lecture échoue et l'on enregistre simplement sans elles.
  const geoKey = (name: string, cp: string | null | undefined) => `${normalizeVillageName(name)}|${cp?.trim() ?? ""}`;
  const withGeo = await supabase.from("tour_route_villages").select("id, name, postal_code, lat, lng, insee_code, geocode_status, geocoded_at").eq("route_id", id);
  const geoReady = !withGeo.error;
  const previous = ((geoReady ? withGeo.data : (await supabase.from("tour_route_villages").select("id, name, postal_code").eq("route_id", id)).data) ?? []) as any[];
  const known = new Map(
    previous
      .filter((v) => v.geocoded_at)
      .map((v) => [geoKey(v.name, v.postal_code), { lat: v.lat, lng: v.lng, insee_code: v.insee_code, geocode_status: v.geocode_status, geocoded_at: v.geocoded_at }] as const),
  );
  const previousById = new Map(previous.map((v) => [v.id as string, v] as const));

  const kept = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  parsed.data.villages.forEach((v, i) => {
    const base = { position: i, name: v.name, postal_code: v.postal_code || null, notes: v.notes || null, pickup_addresses: v.pickup_addresses ?? [], planned_stops: v.planned_stops ?? [] };
    const geo = known.get(geoKey(v.name, v.postal_code));
    const old = v.id ? previousById.get(v.id) : undefined;
    if (old && !kept.has(old.id)) {
      kept.add(old.id);
      const sameCommune = geoKey(old.name, old.postal_code) === geoKey(v.name, v.postal_code);
      updates.push({ id: old.id, patch: { ...base, ...(sameCommune || !geoReady ? {} : (geo ?? NO_GEO)) } });
    } else {
      inserts.push({ organization_id: appUser.organization_id, route_id: id, ...base, ...(geo ?? {}) });
    }
  });

  const removed = previous.map((v) => v.id as string).filter((vid) => !kept.has(vid));
  if (removed.length) {
    const { error } = await supabase.from("tour_route_villages").delete().eq("route_id", id).in("id", removed);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  for (const u of updates) {
    const { error } = await supabase.from("tour_route_villages").update(u.patch).eq("route_id", id).eq("id", u.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (inserts.length) {
    const { error } = await supabase.from("tour_route_villages").insert(inserts);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await supabase.from("tour_routes").update({ updated_at: new Date().toISOString() }).eq("id", id);
  return NextResponse.json({ ok: true });
}
