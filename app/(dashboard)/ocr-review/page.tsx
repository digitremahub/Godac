import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader, EmptyState } from "@/components/ui";
import { OcrReviewCard } from "@/components/fuel/OcrReviewCard";

export default async function OcrReviewPage() {
  const supabase = await createServerSupabaseClient();

  const { data: entries } = await supabase
    .from("fuel_entries")
    .select(
      "id, occurred_at, liters, unit_price, station_name, totalizer_before, totalizer_after, vehicle_km, status, ocr_error, ocr_confidence, ocr_raw, ticket_photo_path, tank_id, product, vehicles(registration), tanks(name), users!fuel_entries_driver_id_fkey(full_name)",
    )
    .in("status", ["awaiting_validation", "ocr_failed"])
    .order("created_at", { ascending: true });

  const withPhotoUrls = await Promise.all(
    (entries ?? []).map(async (entry: any) => {
      if (!entry.ticket_photo_path) return { ...entry, photoUrl: null };
      const { data } = await supabase.storage
        .from(process.env.SUPABASE_STORAGE_BUCKET ?? "fuel-tickets")
        .createSignedUrl(entry.ticket_photo_path, 600);
      return { ...entry, photoUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <div>
      <PageHeader
        title="Revue OCR"
        description="Tickets en attente de validation humaine — la donnée n'est jamais enregistrée sans confirmation."
      />

      {withPhotoUrls.length === 0 ? (
        <EmptyState title="Aucun ticket en attente" description="Tous les tickets OCR ont été validés." />
      ) : (
        <div className="flex flex-col gap-4">
          {withPhotoUrls.map((entry: any) => (
            <OcrReviewCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
