import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Suggestion {
  driverId: string;
  driverName: string;
  raison: string;
  /** Arrêt de tournée colis retrouvé : donne accès à la photo de livraison. */
  stopId?: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Propose le chauffeur concerné par une contestation, du signal le plus
 * fiable au moins fiable : numéro de colis scanné dans une tournée colis,
 * adresse livrée ce jour-là, puis tournée du planning (numéro + date).
 * Toujours une simple suggestion : l'attribution passe par une
 * validation humaine (app/api/contestations/[id]).
 */
export async function suggererChauffeur(
  supabase: SupabaseClient,
  organizationId: string,
  c: { parcel_code: string | null; delivery_address: string | null; delivery_date: string | null; tour_number: string | null },
): Promise<Suggestion | null> {
  const nom = async (id: string) => (await supabase.from("users").select("full_name").eq("id", id).maybeSingle()).data?.full_name ?? "—";

  if (c.parcel_code) {
    const code = c.parcel_code.replace(/\s/g, "");
    const { data } = await supabase
      .from("delivery_stops")
      .select("id, parcel_code, delivery_runs!inner(driver_id, run_date)")
      .eq("organization_id", organizationId)
      .ilike("parcel_code", `%${code}%`)
      .limit(1);
    const run = (data?.[0] as any)?.delivery_runs;
    if (run?.driver_id) {
      return {
        driverId: run.driver_id,
        driverName: await nom(run.driver_id),
        raison: `Colis ${code} scanné dans sa tournée du ${new Date(run.run_date).toLocaleDateString("fr-FR")}`,
        stopId: (data?.[0] as any).id,
      };
    }
  }

  if (c.delivery_address && c.delivery_date) {
    const { data } = await supabase
      .from("delivery_stops")
      .select("id, address, delivery_runs!inner(driver_id, run_date)")
      .eq("organization_id", organizationId)
      .eq("delivery_runs.run_date", c.delivery_date);
    const cible = norm(c.delivery_address);
    const hit = (data ?? []).find((s: any) => {
      const a = norm(s.address);
      return a === cible || a.includes(cible) || cible.includes(a);
    }) as any;
    if (hit?.delivery_runs?.driver_id) {
      return { driverId: hit.delivery_runs.driver_id, driverName: await nom(hit.delivery_runs.driver_id), raison: "Adresse livrée par ce chauffeur à cette date", stopId: hit.id };
    }
  }

  if (c.delivery_date) {
    // Journée de Paris, avec une marge pour les tournées enregistrées en UTC.
    const debut = new Date(Date.parse(`${c.delivery_date}T00:00:00Z`) - 3 * 3_600_000).toISOString();
    const fin = new Date(Date.parse(`${c.delivery_date}T00:00:00Z`) + 27 * 3_600_000).toISOString();
    let q = supabase
      .from("planning_entries")
      .select("driver_id, tour_number")
      .eq("organization_id", organizationId)
      .in("status", ["in_progress", "done"])
      .not("driver_id", "is", null)
      .gte("start_at", debut)
      .lt("start_at", fin);
    if (c.tour_number) q = q.eq("tour_number", c.tour_number.trim());
    const { data } = await q.limit(50);
    const unique = new Set((data ?? []).map((d) => d.driver_id));
    if (data?.length && unique.size === 1 && data[0]!.driver_id) {
      return {
        driverId: data[0]!.driver_id,
        driverName: await nom(data[0]!.driver_id),
        raison: c.tour_number ? `Tournée ${c.tour_number} effectuée ce jour-là` : "Seul chauffeur en tournée ce jour-là",
      };
    }
  }
  return null;
}
