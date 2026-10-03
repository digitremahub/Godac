import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { TankPhotosTable } from "@/components/tanks/TankPhotosTable";

export default async function TankPhotosPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const { data: photos } = await supabase
    .from("tank_photos")
    .select(
      "id, totalizer_reading, note, status, created_at, photo_path, tanks(name), users!tank_photos_submitted_by_fkey(full_name)",
    )
    .order("created_at", { ascending: false });

  const rows = (photos ?? []) as any[];
  const withUrls = await Promise.all(
    rows.map(async (p) => {
      const { data } = await supabase.storage.from("tank-photos").createSignedUrl(p.photo_path, 600);
      return {
        id: p.id,
        tankName: p.tanks?.name ?? "—",
        submittedByName: p.users?.full_name ?? "—",
        totalizerReading: p.totalizer_reading,
        note: p.note,
        status: p.status,
        createdAt: p.created_at,
        photoUrl: data?.signedUrl ?? null,
      };
    }),
  );

  return (
    <div>
      <PageHeader
        title="Photos de cuves"
        description="Index de cuve documenté par photo — vérifié manuellement, jamais extrait automatiquement."
      />
      <TankPhotosTable photos={withUrls} canReview={hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"])} />
    </div>
  );
}
