import Link from "next/link";
import { requireAppUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isModuleEnabled } from "@/lib/organization/modules";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { MessageForm } from "@/components/messenger/MessageForm";
import { MessageThread } from "@/components/messenger/MessageThread";

/**
 * GODAC Messenger (Module) — simple 1:1 chat between org colleagues,
 * no groups/channels in this first version. The contact list is every
 * other active user in the org; a real "who should talk to whom"
 * directory (by service, by role) can layer on top later without
 * changing the messages table.
 */
export default async function MessengerPage({ searchParams }: { searchParams: Promise<{ with?: string }> }) {
  const params = await searchParams;
  const appUser = await requireAppUser();
  const supabase = await createServerSupabaseClient();

  const messengerEnabled = await isModuleEnabled(supabase, appUser.organization_id, "messenger");
  if (!messengerEnabled) {
    return (
      <EmptyState
        title="Module Messenger non activé"
        description="Activez-le depuis les paramètres de votre organisation pour discuter entre collègues."
      />
    );
  }

  const { data: colleagues } = await supabase
    .from("users")
    .select("id, full_name, role")
    .eq("organization_id", appUser.organization_id)
    .eq("active", true)
    .neq("id", appUser.id)
    .order("full_name");

  const contactId = params.with && (colleagues ?? []).some((c) => c.id === params.with) ? params.with : undefined;

  if (contactId) {
    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .eq("sender_id", contactId)
      .eq("recipient_id", appUser.id)
      .is("read_at", null);
  }

  const { data: messages } = contactId
    ? await supabase
        .from("messages")
        .select("id, sender_id, recipient_id, body, photo_path, created_at")
        .or(`and(sender_id.eq.${appUser.id},recipient_id.eq.${contactId}),and(sender_id.eq.${contactId},recipient_id.eq.${appUser.id})`)
        .order("created_at", { ascending: true })
        .limit(200)
    : { data: null };

  const messagesWithPhotos = await Promise.all(
    ((messages ?? []) as any[]).map(async (m) => {
      if (!m.photo_path) return { ...m, photoUrl: null };
      const { data } = await supabase.storage.from("messenger-photos").createSignedUrl(m.photo_path, 600);
      return { ...m, photoUrl: data?.signedUrl ?? null };
    }),
  );

  const contact = (colleagues ?? []).find((c) => c.id === contactId);

  return (
    <div>
      <PageHeader title="Messenger" description="Discutez directement avec vos collègues." />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[240px_1fr]">
        <Card className="flex flex-col gap-1 !p-2">
          {(colleagues ?? []).length === 0 ? (
            <p className="p-2 text-xs text-navy/60">Aucun autre collègue actif.</p>
          ) : (
            (colleagues ?? []).map((c) => (
              <Link
                key={c.id}
                href={`/messenger?with=${c.id}`}
                className={`rounded-lg px-3 py-2 text-sm ${c.id === contactId ? "bg-teal/10 font-medium" : "hover:bg-navy/5"}`}
              >
                {c.full_name}
              </Link>
            ))
          )}
        </Card>

        <div className="flex flex-col gap-3">
          {!contact ? (
            <EmptyState title="Choisissez un collègue" description="Sélectionnez une conversation dans la liste à gauche." />
          ) : (
            <>
              <Card className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
                <MessageThread messages={messagesWithPhotos} currentUserId={appUser.id} />
              </Card>
              <MessageForm recipientId={contact.id} senderId={appUser.id} organizationId={appUser.organization_id} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
