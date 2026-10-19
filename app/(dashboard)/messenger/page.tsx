import { garderPage } from "@/lib/acces/garde-page";
import Link from "next/link";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { synchroniserGroupesEquipeSansErreur } from "@/lib/messenger/synchro-serveur";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { MessageForm } from "@/components/messenger/MessageForm";
import { MessageThread } from "@/components/messenger/MessageThread";
import { AutoRefresh } from "@/components/messenger/AutoRefresh";
import { GroupThread, PinnedAnnouncements, type GroupMessageView, type PinnedView } from "@/components/messenger/groupes/GroupThread";
import { GroupMessageForm } from "@/components/messenger/groupes/GroupMessageForm";
import { GroupInfoSheet } from "@/components/messenger/groupes/GroupInfoSheet";
import { CreateGroupButton, type TeamOption } from "@/components/messenger/groupes/CreateGroupButton";
import { IconUsers } from "@/components/layout/icons";
import {
  estChefEquipe,
  libelleVuPar,
  peutAdministrerGroupe,
  peutEcrireGroupe,
  peutReagir,
  type GroupAccess,
  type GroupMemberRole,
} from "@/lib/messenger/groupes";

interface GroupListRow {
  id: string;
  kind: "team" | "custom";
  name: string;
  service_id: string | null;
  announcement_only: boolean;
  services: { name: string; team_leader_user_id: string | null; team_leader_email: string | null } | null;
  message_group_members: { user_id: string; role: GroupMemberRole; source: "auto" | "manual"; muted: boolean; last_read_at: string | null }[];
}

/**
 * GODAC Messenger (Module) — discussions 1:1 entre collègues et
 * groupes d'équipe : un groupe par service, tenu à jour
 * automatiquement (membres actifs du service + chef d'équipe), plus
 * les groupes ponctuels créés par un chef d'équipe / manager /
 * direction (voir supabase/migrations/20260101000160).
 */
export default async function MessengerPage({ searchParams }: { searchParams: Promise<{ with?: string; groupe?: string }> }) {
  const params = await searchParams;
  const g = await garderPage("communication.messenger");
  if (!g.ok) return g.ecran;
  const appUser = g.appUser;
  const supabase = await createServerSupabaseClient();


  // Groupes d'équipe tenus à jour à l'ouverture (et après chaque
  // changement de service ou de compte, voir lib/messenger/synchro-serveur).
  await synchroniserGroupesEquipeSansErreur(createAdminSupabaseClient(), appUser.organization_id);

  const [{ data: colleagues }, { data: groupRows }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, role")
      .eq("organization_id", appUser.organization_id)
      .eq("active", true)
      .neq("id", appUser.id)
      .order("full_name"),
    supabase
      .from("message_groups")
      .select(
        "id, kind, name, service_id, announcement_only, services(name, team_leader_user_id, team_leader_email), message_group_members(user_id, role, source, muted, last_read_at)",
      )
      .order("kind", { ascending: false })
      .order("name"),
  ]);

  const groups = (groupRows ?? []) as unknown as GroupListRow[];
  const myMembership = (g: GroupListRow) => g.message_group_members.find((m) => m.user_id === appUser.id) ?? null;
  const myGroups = groups.filter((g) => myMembership(g));
  const otherGroups = appUser.role === "direction" ? groups.filter((g) => !myMembership(g)) : [];

  const unreadCounts = new Map<string, number>(
    await Promise.all(
      myGroups.map(async (g) => {
        const lastRead = myMembership(g)?.last_read_at;
        let q = supabase.from("group_messages").select("id", { count: "exact", head: true }).eq("group_id", g.id).neq("sender_id", appUser.id);
        if (lastRead) q = q.gt("created_at", lastRead);
        const { count } = await q;
        return [g.id, count ?? 0] as [string, number];
      }),
    ),
  );

  const selectedGroup = params.groupe ? groups.find((g) => g.id === params.groupe) : undefined;
  const contactId = !selectedGroup && params.with && (colleagues ?? []).some((c) => c.id === params.with) ? params.with : undefined;

  // « Créer un groupe » : équipes dont on est responsable (direction : toutes + transversal).
  const nameById = new Map((colleagues ?? []).map((c) => [c.id as string, c.full_name as string]));
  nameById.set(appUser.id, appUser.full_name);
  const teamOptions: TeamOption[] = groups
    .filter((g) => g.kind === "team" && (appUser.role === "direction" || myMembership(g)?.role === "admin"))
    .map((g) => ({
      service_id: g.service_id,
      label: g.services?.name ?? g.name,
      members: g.message_group_members.filter((m) => nameById.has(m.user_id)).map((m) => ({ id: m.user_id, full_name: nameById.get(m.user_id)! })),
    }));
  if (appUser.role === "direction") {
    teamOptions.push({
      service_id: null,
      label: "Transversal (toute l'entreprise)",
      members: (colleagues ?? []).map((c) => ({ id: c.id as string, full_name: c.full_name as string })),
    });
  }

  return (
    <div>
      <PageHeader title="Messenger" description="Groupes d'équipe et discussions directes avec vos collègues." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[260px_1fr]">
        <Card className={`flex flex-col gap-1 !p-2 ${selectedGroup || contactId ? "hidden md:flex" : ""}`}>
          {teamOptions.length > 0 && (
            <div className="p-1">
              <CreateGroupButton teams={teamOptions} currentUserId={appUser.id} />
            </div>
          )}
          <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-navy/50">Groupes</p>
          {myGroups.length === 0 ? (
            <p className="p-2 text-xs text-navy/60">Aucun groupe : rattachez-vous à un service pour rejoindre son groupe d&apos;équipe.</p>
          ) : (
            myGroups.map((g) => <GroupLink key={g.id} g={g} active={g.id === selectedGroup?.id} unread={unreadCounts.get(g.id) ?? 0} />)
          )}
          {otherGroups.length > 0 && (
            <details className="px-1">
              <summary className="cursor-pointer px-1 py-1 text-xs text-navy/60">Autres groupes de l&apos;entreprise ({otherGroups.length})</summary>
              {otherGroups.map((g) => (
                <GroupLink key={g.id} g={g} active={g.id === selectedGroup?.id} unread={0} />
              ))}
            </details>
          )}
          <p className="px-2 pt-3 text-xs font-semibold uppercase tracking-wide text-navy/50">Discussions</p>
          {(colleagues ?? []).length === 0 ? (
            <p className="p-2 text-xs text-navy/60">Aucun autre collègue actif.</p>
          ) : (
            (colleagues ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/messenger?with=${c.id}`}
                className={`rounded-lg px-3 py-2 text-sm ${c.id === contactId ? "bg-teal/10 font-medium" : "hover:bg-navy/[0.04]"}`}
              >
                {c.full_name}
              </Link>
            ))
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          {selectedGroup ? (
            <GroupPane group={selectedGroup} appUser={appUser} supabase={supabase} />
          ) : contactId ? (
            <DirectPane contactId={contactId} contactName={nameById.get(contactId) ?? ""} appUser={appUser} supabase={supabase} />
          ) : (
            <EmptyState title="Choisissez une conversation" description="Sélectionnez un groupe ou un collègue dans la liste." />
          )}
        </div>
      </div>
    </div>
  );
}

function GroupLink({ g, active, unread }: { g: GroupListRow; active: boolean; unread: number }) {
  const count = g.message_group_members.length;
  return (
    <Link
      href={`/messenger?groupe=${g.id}`}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${active ? "bg-teal/10 font-medium" : "hover:bg-navy/[0.04]"}`}
    >
      <IconUsers className="h-4 w-4 shrink-0 text-navy/50" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{g.name}</span>
        <span className="block truncate text-xs text-navy/55">
          {g.kind === "custom" && g.services?.name ? `${g.services.name} · ` : g.kind === "team" ? "Équipe · " : ""}
          {count} membre{count > 1 ? "s" : ""}
        </span>
      </span>
      {unread > 0 && <span className="badge-orange shrink-0">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}

const RetourListe = () => (
  <Link href="/messenger" className="text-sm text-teal-ink underline md:hidden">
    ← Conversations
  </Link>
);

async function signer(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, path: string | null) {
  if (!path) return null;
  const { data } = await supabase.storage.from("messenger-photos").createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

async function GroupPane({
  group,
  appUser,
  supabase,
}: {
  group: GroupListRow;
  appUser: Awaited<ReturnType<typeof requireAppUser>>;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}) {
  const me = group.message_group_members.find((m) => m.user_id === appUser.id) ?? null;
  const access: GroupAccess = { userRole: appUser.role, memberRole: me?.role ?? null, active: appUser.active };
  const canAdmin = peutAdministrerGroupe(access);
  const canWrite = peutEcrireGroupe(access, group.announcement_only);
  const now = new Date().toISOString();

  const memberIds = group.message_group_members.map((m) => m.user_id);
  const [{ data: memberUsers }, { data: rawMessages }, { data: rawPinned }] = await Promise.all([
    supabase.from("users").select("id, full_name, email, contact_email, role, active").in("id", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]),
    supabase
      .from("group_messages")
      .select(
        "id, sender_id, body, attachment_path, attachment_name, attachment_type, is_announcement, pinned_at, created_at, sender:users!group_messages_sender_id_fkey(full_name), group_message_reactions(user_id, emoji)",
      )
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("group_messages")
      .select("id, body, attachment_path, attachment_name, attachment_type, created_at, sender_id, sender:users!group_messages_sender_id_fkey(full_name), group_message_reads(user_id)")
      .eq("group_id", group.id)
      .not("pinned_at", "is", null)
      .order("pinned_at", { ascending: false }),
  ]);

  // Ouvrir le groupe vaut lecture : non-lus remis à zéro, Infos équipe marquées vues.
  if (me) {
    await supabase.from("message_group_members").update({ last_read_at: now }).eq("group_id", group.id).eq("user_id", appUser.id);
    const aMarquer = ((rawPinned ?? []) as any[]).filter(
      (p) => p.sender_id !== appUser.id && !(p.group_message_reads ?? []).some((r: { user_id: string }) => r.user_id === appUser.id),
    );
    if (aMarquer.length > 0) {
      await supabase
        .from("group_message_reads")
        .upsert(aMarquer.map((p) => ({ message_id: p.id, user_id: appUser.id })), { onConflict: "message_id,user_id", ignoreDuplicates: true });
      aMarquer.forEach((p) => p.group_message_reads.push({ user_id: appUser.id }));
    }
  }

  const service = group.services ? { id: group.service_id ?? "", ...group.services } : null;
  const users = (memberUsers ?? []) as { id: string; full_name: string; email: string | null; contact_email: string | null; role: any; active: boolean }[];
  const nameOf = new Map(users.map((u) => [u.id, u.full_name]));
  const members = group.message_group_members
    .filter((m) => nameOf.has(m.user_id))
    .map((m) => {
      const u = users.find((x) => x.id === m.user_id)!;
      return { id: m.user_id, full_name: u.full_name, role: m.role, chef: service ? estChefEquipe(u, service) : false };
    })
    .sort((a, b) => Number(b.chef) - Number(a.chef) || Number(b.role === "admin") - Number(a.role === "admin") || a.full_name.localeCompare(b.full_name, "fr"));

  const messages: GroupMessageView[] = await Promise.all(
    ((rawMessages ?? []) as any[]).reverse().map(async (m) => {
      const byEmoji = new Map<string, { emoji: string; count: number; mine: boolean }>();
      for (const r of (m.group_message_reactions ?? []) as { user_id: string; emoji: string }[]) {
        const e = byEmoji.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
        e.count += 1;
        e.mine ||= r.user_id === appUser.id;
        byEmoji.set(r.emoji, e);
      }
      return {
        id: m.id,
        sender_id: m.sender_id,
        sender_name: m.sender?.full_name ?? "—",
        body: m.body,
        attachmentUrl: await signer(supabase, m.attachment_path),
        attachment_name: m.attachment_name,
        attachment_type: m.attachment_type,
        is_announcement: m.is_announcement,
        pinned: Boolean(m.pinned_at),
        created_at: m.created_at,
        reactions: Array.from(byEmoji.values()),
      };
    }),
  );

  const pinned: PinnedView[] = await Promise.all(
    ((rawPinned ?? []) as any[]).map(async (p) => {
      const readers = ((p.group_message_reads ?? []) as { user_id: string }[]).map((r) => r.user_id);
      const vu = libelleVuPar(readers, members.map((m) => m.id), p.sender_id);
      const readerSet = new Set(readers);
      return {
        id: p.id,
        sender_name: p.sender?.full_name ?? "—",
        body: p.body,
        attachmentUrl: await signer(supabase, p.attachment_path),
        attachment_name: p.attachment_name,
        attachment_type: p.attachment_type,
        created_at: p.created_at,
        vuParLibelle: vu.libelle,
        lecteurs: members.filter((m) => m.id !== p.sender_id && readerSet.has(m.id)).map((m) => m.full_name),
        nonLus: members.filter((m) => m.id !== p.sender_id && !readerSet.has(m.id)).map((m) => m.full_name),
      };
    }),
  );

  // Collègues ajoutables à un groupe ponctuel : l'équipe du service (direction : tous).
  let addable: { id: string; full_name: string }[] = [];
  if (canAdmin && group.kind === "custom") {
    if (group.service_id && appUser.role !== "direction") {
      const { data: team } = await supabase
        .from("message_groups")
        .select("message_group_members(user_id, users(full_name))")
        .eq("service_id", group.service_id)
        .eq("kind", "team")
        .maybeSingle();
      addable = ((team?.message_group_members ?? []) as any[]).map((m) => ({ id: m.user_id, full_name: m.users?.full_name ?? "—" }));
    } else {
      const { data: all } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("organization_id", appUser.organization_id)
        .eq("active", true)
        .order("full_name");
      addable = (all ?? []) as { id: string; full_name: string }[];
    }
  }

  return (
    <>
      <AutoRefresh />
      <RetourListe />
      <Card className="flex items-center justify-between gap-3 !py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{group.name}</h2>
          <p className="truncate text-xs text-navy/60">
            {group.kind === "team" ? "Groupe d'équipe" : "Groupe"}
            {group.kind === "custom" && group.services?.name ? ` · ${group.services.name}` : ""} · {members.length} membre{members.length > 1 ? "s" : ""}
            {group.announcement_only ? " · seuls les responsables écrivent" : ""}
            {me?.muted ? " · en sourdine" : ""}
          </p>
        </div>
        <GroupInfoSheet
          groupId={group.id}
          kind={group.kind}
          name={group.name}
          serviceName={group.services?.name ?? null}
          announcementOnly={group.announcement_only}
          members={members}
          isMember={Boolean(me)}
          joinedManually={me?.source === "manual"}
          muted={me?.muted ?? false}
          canAdmin={canAdmin}
          canJoin={appUser.role === "direction"}
          addableMembers={addable}
          currentUserId={appUser.id}
        />
      </Card>
      <PinnedAnnouncements groupId={group.id} pinned={pinned} canAdmin={canAdmin} />
      <Card className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        <GroupThread groupId={group.id} messages={messages} currentUserId={appUser.id} canAdmin={canAdmin} canReact={peutReagir(access)} />
      </Card>
      {canWrite ? (
        <GroupMessageForm
          groupId={group.id}
          senderId={appUser.id}
          organizationId={appUser.organization_id}
          canAnnounce={canAdmin}
          members={members.map((m) => ({ id: m.id, full_name: m.full_name }))}
        />
      ) : (
        <p className="rounded-xl bg-navy/[0.04] px-3 py-2 text-center text-sm text-navy/65">
          {me ? "Seuls les responsables écrivent dans ce groupe. Vous pouvez réagir aux messages." : "Rejoignez le groupe (bouton « Infos ») pour y écrire."}
        </p>
      )}
    </>
  );
}

async function DirectPane({
  contactId,
  contactName,
  appUser,
  supabase,
}: {
  contactId: string;
  contactName: string;
  appUser: Awaited<ReturnType<typeof requireAppUser>>;
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
}) {
  await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("sender_id", contactId)
    .eq("recipient_id", appUser.id)
    .is("read_at", null);

  const { data: messages } = await supabase
    .from("messages")
    .select("id, sender_id, recipient_id, body, photo_path, created_at")
    .or(`and(sender_id.eq.${appUser.id},recipient_id.eq.${contactId}),and(sender_id.eq.${contactId},recipient_id.eq.${appUser.id})`)
    .order("created_at", { ascending: true })
    .limit(200);

  const messagesWithPhotos = await Promise.all(
    ((messages ?? []) as any[]).map(async (m) => ({ ...m, photoUrl: await signer(supabase, m.photo_path) })),
  );

  return (
    <>
      <RetourListe />
      <Card className="!py-3">
        <h2 className="truncate text-base font-bold">{contactName}</h2>
      </Card>
      <Card className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        <MessageThread messages={messagesWithPhotos} currentUserId={appUser.id} />
      </Card>
      <MessageForm recipientId={contactId} senderId={appUser.id} organizationId={appUser.organization_id} />
    </>
  );
}
