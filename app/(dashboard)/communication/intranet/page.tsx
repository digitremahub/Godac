import { garderPage } from "@/lib/acces/garde-page";
import { hasRole } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui";
import { AnnouncementForm } from "@/components/intranet/AnnouncementForm";
import { AnnouncementsList } from "@/components/intranet/AnnouncementsList";
import { MeetingRequestForm } from "@/components/intranet/MeetingRequestForm";
import { MeetingRequestsList } from "@/components/intranet/MeetingRequestsList";
import { ConvocationsList } from "@/components/intranet/ConvocationsList";

export default async function IntranetPage() {
  const g = await garderPage("communication.intranet");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  const isManagerLike = hasRole(appUser.role, ["manager", "direction"]);
  const canRequestMeeting = appUser.role !== "direction";

  const [{ data: announcements }, { data: myReads }, { data: services }, { data: meetingRequests }, { data: convocations }] =
    await Promise.all([
      supabase
        .from("announcements")
        .select(
          "id, title, body, service_id, requires_acknowledgement, created_at, users!announcements_created_by_fkey(full_name), services(name)",
        )
        .order("created_at", { ascending: false }),
      supabase.from("announcement_reads").select("announcement_id").eq("user_id", appUser.id),
      supabase.from("services").select("id, name").order("name"),
      supabase
        .from("meeting_requests")
        .select("id, reason, preferred_date, status, created_at, requested_by, users!meeting_requests_requested_by_fkey(full_name)")
        .order("created_at", { ascending: false }),
      isManagerLike
        ? supabase
            .from("convocations")
            .select("id, reason, scheduled_at, location, status, employee_id, users!convocations_employee_id_fkey(full_name)")
            .order("created_at", { ascending: false })
        : supabase
            .from("convocations")
            .select("id, reason, scheduled_at, location, status, employee_id")
            .eq("employee_id", appUser.id)
            .order("created_at", { ascending: false }),
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

      <div className="flex flex-col gap-3">
        <h2 className="text-lg">Rendez-vous</h2>
        {canRequestMeeting && <MeetingRequestForm />}
        <MeetingRequestsList
          canManage={isManagerLike}
          requests={((meetingRequests ?? []) as any[]).map((r) => ({
            id: r.id,
            requesterName: r.users?.full_name ?? "—",
            reason: r.reason,
            preferredDate: r.preferred_date,
            status: r.status,
            createdAt: r.created_at,
            isOwn: r.requested_by === appUser.id,
          }))}
        />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg">Convocations</h2>
        <ConvocationsList
          canManage={isManagerLike}
          convocations={((convocations ?? []) as any[]).map((c) => ({
            id: c.id,
            employeeName: c.users?.full_name ?? "—",
            reason: c.reason,
            scheduledAt: c.scheduled_at,
            location: c.location,
            status: c.status,
            isOwn: c.employee_id === appUser.id,
          }))}
        />
      </div>
    </div>
  );
}
