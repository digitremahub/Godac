"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AssistantTabBody, type AssistantMessage } from "@/components/chat/AssistantTabBody";
import { ConversationTabBody } from "@/components/chat/ConversationTabBody";
import { IconChatBubble, IconX } from "@/components/layout/icons";

interface Contact {
  id: string;
  full_name: string;
}
interface ConversationTab {
  contactId: string;
  contactName: string;
}

/**
 * One floating bubble for everything that isn't a dedicated page:
 * the help assistant (first tab, always present when available) and
 * 1:1 conversations (one closable tab each). A tab (re)appears on its
 * own whenever a new message arrives for a conversation the viewer
 * doesn't already have open — see the polling effect below, the only
 * way this codebase has to notice "something new happened" without a
 * realtime subscription.
 */
export function FloatingChatWidget({
  assistantAvailable,
  messengerAvailable,
  currentUserId,
  organizationId,
}: {
  assistantAvailable: boolean;
  messengerAvailable: boolean;
  currentUserId: string;
  organizationId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(assistantAvailable ? "assistant" : "");

  // Deep-link from an alert ("votre question a reçu une réponse", see
  // lib/alerts/resolve-url.ts) — the answer lives here, not on a page
  // of its own, so ?assistant=1 is how that alert opens on it.
  // Reads from the shared router search params (not just on mount):
  // this widget is mounted once in the dashboard layout and survives
  // client-side navigation between pages, so a link landing on
  // /dashboard?assistant=1 from elsewhere doesn't remount it.
  useEffect(() => {
    if (searchParams.get("assistant") !== "1" || !assistantAvailable) return;
    setOpen(true);
    setActiveKey("assistant");
    const qs = new URLSearchParams(searchParams.toString());
    qs.delete("assistant");
    router.replace(qs.toString() ? `${pathname}?${qs.toString()}` : pathname, { scroll: false });
  }, [searchParams, assistantAvailable, pathname, router]);
  const [conversations, setConversations] = useState<ConversationTab[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [contactQuery, setContactQuery] = useState("");
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [unreadBySender, setUnreadBySender] = useState<Record<string, { full_name: string; unreadCount: number }>>({});

  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const [assistantLoaded, setAssistantLoaded] = useState(false);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState<string | null>(null);
  const [relayNotice, setRelayNotice] = useState<{ recipientLabel: string; emergencyPhone: string | null } | null>(null);

  useEffect(() => {
    if (!messengerAvailable) return;
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch("/api/messenger/unread-senders");
        const json = await res.json();
        if (cancelled || !Array.isArray(json.senders)) return;
        const next: Record<string, { full_name: string; unreadCount: number }> = {};
        for (const s of json.senders) next[s.id] = { full_name: s.full_name, unreadCount: s.unreadCount };
        setUnreadBySender(next);
        setConversations((prev) => {
          const existingIds = new Set(prev.map((c) => c.contactId));
          const additions = json.senders.filter((s: any) => !existingIds.has(s.id)).map((s: any) => ({ contactId: s.id, contactName: s.full_name }));
          return additions.length === 0 ? prev : [...prev, ...additions];
        });
      } catch {
        // Best-effort polling — a failed tick just tries again later.
      }
    }
    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [messengerAvailable]);

  useEffect(() => {
    if (activeKey === "assistant" && !assistantLoaded) {
      fetch("/api/assistant/conversation")
        .then((r) => r.json())
        .then((json) => {
          if (Array.isArray(json.messages)) setAssistantMessages(json.messages);
          setAssistantLoaded(true);
        })
        .catch(() => setAssistantLoaded(true));
    }
  }, [activeKey, assistantLoaded]);

  function openConversation(contactId: string, contactName: string) {
    setConversations((prev) => (prev.some((c) => c.contactId === contactId) ? prev : [...prev, { contactId, contactName }]));
    setActiveKey(`conv:${contactId}`);
    setOpen(true);
    setPickerOpen(false);
  }

  function closeConversation(contactId: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.contactId !== contactId);
      if (activeKey === `conv:${contactId}`) {
        setActiveKey(assistantAvailable ? "assistant" : next[0] ? `conv:${next[0].contactId}` : "");
      }
      return next;
    });
  }

  async function togglePicker() {
    setPickerOpen((v) => !v);
    setContactQuery("");
    if (!contacts) {
      const res = await fetch("/api/messenger/contacts");
      const json = await res.json();
      if (Array.isArray(json.contacts)) setContacts(json.contacts);
    }
  }

  async function sendAssistant() {
    const text = assistantInput.trim();
    if (!text || assistantBusy) return;
    setAssistantBusy(true);
    setAssistantError(null);
    setRelayNotice(null);
    setAssistantMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", content: text, needs_human: null, feedback: null, created_at: new Date().toISOString() },
    ]);
    setAssistantInput("");
    try {
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setAssistantMessages((prev) => [
        ...prev,
        { id: json.messageId, role: "assistant", content: json.answer, needs_human: json.needsHuman, feedback: null, created_at: new Date().toISOString() },
      ]);
      if (json.relay) setRelayNotice(json.relay);
    } catch (e) {
      setAssistantError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function escalateAssistant() {
    setAssistantBusy(true);
    setAssistantError(null);
    try {
      const res = await fetch("/api/assistant/escalate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setRelayNotice(json.relay);
    } catch (e) {
      setAssistantError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setAssistantBusy(false);
    }
  }

  async function voteAssistant(messageId: string, useful: boolean) {
    setAssistantMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: useful } : m)));
    try {
      const res = await fetch("/api/assistant/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: messageId, useful }),
      });
      const json = await res.json();
      if (res.ok && json.relay) setRelayNotice(json.relay);
    } catch {
      // Feedback is best-effort — never block the conversation on it.
    }
  }

  if (!assistantAvailable && !messengerAvailable) return null;

  const totalUnread = Object.values(unreadBySender).reduce((sum, s) => sum + s.unreadCount, 0);

  return (
    <>
      <button
        type="button"
        className="fixed bottom-[6.5rem] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-marine text-teal shadow-pop transition-transform hover:scale-105 lg:bottom-6"
        onClick={() => setOpen((v) => !v)}
        aria-label="Messages et assistant"
        aria-expanded={open}
      >
        {open ? <IconX className="h-6 w-6" /> : <IconChatBubble className="h-6 w-6" />}
        {!open && totalUnread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange px-1 text-xs font-bold text-white">
            {totalUnread > 9 ? "9+" : totalUnread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-[11rem] right-4 z-40 flex h-[28rem] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-2xl border border-navy/10 bg-surface shadow-pop lg:bottom-24">
          <div className="flex items-end border-b border-navy/10 bg-navy/[0.04]">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 pt-2">
            {assistantAvailable && (
              <button
                className={`shrink-0 rounded-t-lg px-3 py-1.5 text-xs font-medium ${activeKey === "assistant" ? "bg-surface" : "text-navy/65"}`}
                onClick={() => {
                  setActiveKey("assistant");
                  setPickerOpen(false);
                }}
              >
                Assistant
              </button>
            )}
            {conversations.map((c) => (
              <div
                key={c.contactId}
                className={`flex shrink-0 items-center gap-1 rounded-t-lg px-2 py-1.5 text-xs font-medium ${
                  activeKey === `conv:${c.contactId}` ? "bg-surface" : "text-navy/65"
                }`}
              >
                <button
                  onClick={() => {
                    setActiveKey(`conv:${c.contactId}`);
                    setPickerOpen(false);
                  }}
                  className="flex items-center gap-1"
                >
                  {c.contactName.split(" ")[0]}
                  {unreadBySender[c.contactId] && activeKey !== `conv:${c.contactId}` && <span className="h-1.5 w-1.5 rounded-full bg-orange" />}
                </button>
                <button
                  type="button"
                  onClick={() => closeConversation(c.contactId)}
                  aria-label={`Fermer la conversation avec ${c.contactName}`}
                  className="text-navy/60 hover:text-orange-ink"
                >
                  <IconX className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
                </button>
              </div>
            ))}
          </div>
            {messengerAvailable && (
              <button
                type="button"
                className={`mb-1 mr-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg font-semibold ${
                  pickerOpen ? "bg-marine text-teal" : "bg-surface text-navy shadow-card hover:bg-paper"
                }`}
                onClick={togglePicker}
                aria-label="Nouvelle conversation"
                aria-expanded={pickerOpen}
              >
                <span aria-hidden="true">+</span>
              </button>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {pickerOpen && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="border-b border-navy/[0.08] p-3">
                  <p className="mb-2 text-sm font-semibold">Nouvelle conversation</p>
                  <input
                    className="input"
                    aria-label="Rechercher un collègue"
                    placeholder="Rechercher un collègue…"
                    value={contactQuery}
                    onChange={(e) => setContactQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                  {!contacts ? (
                    <li className="px-4 py-3 text-sm text-navy/60">Chargement…</li>
                  ) : contacts.filter((c) => c.full_name.toLowerCase().includes(contactQuery.trim().toLowerCase())).length === 0 ? (
                    <li className="px-4 py-3 text-sm text-navy/60">Aucun collègue trouvé.</li>
                  ) : (
                    contacts
                      .filter((c) => c.full_name.toLowerCase().includes(contactQuery.trim().toLowerCase()))
                      .map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="flex min-h-[48px] w-full items-center gap-3 px-4 text-left text-sm hover:bg-navy/[0.04]"
                            onClick={() => openConversation(c.id, c.full_name)}
                          >
                            <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-marine text-[11px] font-bold text-teal">
                              {c.full_name
                                .split(/\s+/)
                                .map((p) => p[0])
                                .slice(0, 2)
                                .join("")
                                .toUpperCase()}
                            </span>
                            <span className="truncate">{c.full_name}</span>
                          </button>
                        </li>
                      ))
                  )}
                </ul>
              </div>
            )}
            <div className={pickerOpen ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
            {assistantAvailable && (
              <div className={activeKey === "assistant" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <AssistantTabBody
                  messages={assistantMessages}
                  loaded={assistantLoaded}
                  input={assistantInput}
                  busy={assistantBusy}
                  error={assistantError}
                  relayNotice={relayNotice}
                  onInputChange={setAssistantInput}
                  onSend={sendAssistant}
                  onEscalate={escalateAssistant}
                  onVote={voteAssistant}
                />
              </div>
            )}
            {conversations.map((c) => (
              <div key={c.contactId} className={activeKey === `conv:${c.contactId}` ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <ConversationTabBody
                  contactId={c.contactId}
                  contactName={c.contactName}
                  currentUserId={currentUserId}
                  organizationId={organizationId}
                  isActive={activeKey === `conv:${c.contactId}`}
                />
              </div>
            ))}
            {!activeKey && (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-navy/60">
                Choisissez une conversation ou démarrez-en une nouvelle (+).
              </div>
            )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
