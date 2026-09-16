import { requireAppUser, hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, EmptyState } from "@/components/ui";
import { AnnouncementForm } from "@/components/intranet/AnnouncementForm";
import { AnnouncementsList } from "@/components/intranet/AnnouncementsList";

export default async function IntranetPage() {
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const intranetEnabled = await isModuleEnabled(supabase, appUser.organization_id, "intranet");
  if (!intranetEnabled) {
    return (
      <EmptyState
        title="Module Intranet & Convocations non activé"
        description="Activez-le depuis les paramètres de votre organisation."
      />
    );
  }

  const isManagerLike = hasRole(appUser.role, ["manager", "manager_chauffeur", "direction"]);

  const [{ data: announcements }, { data: myReads }, { data: services }] = await Promise.all([
    supabase
      .from("announcements")
      .select(
        "id, title, body, service_id, requires_acknowledgement, created_at, users!announcements_created_by_fkey(full_name), services(name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("announcement_reads").select("announcement_id").eq("user_id", appUser.id),
    supabase.from("services").select("id, name").order("name"),
  ]);

  const rows = (announcements ?? []) as any[];
  const myReadIds = new Set((myReads ?? []).map((r) => r.announcement_id));

  const readCountByAnnouncement = new Map<string, number>();
  if (isManagerLike && rows.length > 0) {
    const { data: allReads } = await supabase
      .from("announcement_reads")
      .select("announcement_id")
      .in(
        "announcement_id",
        rows.map((a) => a.id),
      );
    for (const r of allReads ?? []) {
      readCountByAnnouncement.set(r.announcement_id, (readCountByAnnouncement.get(r.announcement_id) ?? 0) + 1);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Intranet & Convocations" description="Notes de service et convocations, avec accusé de lecture." />

      {isManagerLike && <AnnouncementForm services={services ?? []} />}

      <AnnouncementsList
        announcements={rows.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          serviceName: a.services?.name ?? null,
          authorName: a.users?.full_name ?? "—",
          requiresAcknowledgement: a.requires_acknowledgement,
          createdAt: a.created_at,
          isRead: myReadIds.has(a.id),
          readCount: isManagerLike && a.requires_acknowledgement ? readCountByAnnouncement.get(a.id) ?? 0 : null,
        }))}
      />
    </div>
  );
}
