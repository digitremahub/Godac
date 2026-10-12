"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageForm } from "@/components/messenger/MessageForm";
import { MessageThread, type MessageRow } from "@/components/messenger/MessageThread";

/**
 * One conversation's body inside the floating widget's tab panel.
 * Kept mounted (just hidden) while its tab isn't active so the thread
 * doesn't need to be refetched on every tab switch — refetching (and
 * therefore marking the other side's messages read) only happens on
 * mount and whenever this tab becomes the active one again.
 */
export function ConversationTabBody({
  contactId,
  contactName,
  currentUserId,
  organizationId,
  isActive,
}: {
  contactId: string;
  contactName: string;
  currentUserId: string;
  organizationId: string;
  isActive: boolean;
}) {
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchThread = useCallback(async () => {
    try {
      const res = await fetch(`/api/messenger/thread?with=${contactId}`);
      const json = await res.json();
      if (Array.isArray(json.messages)) setMessages(json.messages);
    } finally {
      setLoaded(true);
    }
  }, [contactId]);

  useEffect(() => {
    if (isActive) fetchThread();
  }, [isActive, fetchThread]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-navy/10 bg-navy/5 p-3">
        <p className="font-display text-sm font-extrabold">{contactName}</p>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <p className="text-sm text-navy/60">Chargement…</p>
        ) : (
          <div className="flex flex-col gap-2">
            <MessageThread messages={messages} currentUserId={currentUserId} onChanged={fetchThread} />
          </div>
        )}
      </div>
      <div className="border-t border-navy/10 p-3">
        <MessageForm recipientId={contactId} senderId={currentUserId} organizationId={organizationId} onSent={fetchThread} />
      </div>
    </div>
  );
}
