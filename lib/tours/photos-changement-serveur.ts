import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PhotoChangement } from "@/lib/tours/changement-vehicule";

/** Enregistre les photos d'état prises lors d'un changement de véhicule. */
export async function enregistrerPhotosChangement(
  supabase: SupabaseClient,
  params: { organizationId: string; planningEntryId: string; vehicleId: string; driverId: string; stage: "depart" | "retour"; photos: PhotoChangement[] },
) {
  if (!params.photos.length) return;
  const { error } = await supabase.from("vehicle_change_photos").insert(
    params.photos.map((p) => ({
      organization_id: params.organizationId,
      planning_entry_id: params.planningEntryId,
      vehicle_id: params.vehicleId,
      driver_id: params.driverId,
      stage: params.stage,
      kind: p.kind,
      photo_path: p.path,
    })),
  );
  if (error) console.error("photos changement véhicule", error);
}
