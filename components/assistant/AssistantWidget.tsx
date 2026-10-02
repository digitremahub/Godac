"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/assistant/rate-limit";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  needs_human: boolean | null;
  feedback: boolean | null;
  created_at: string;
}

/**
 * Lot B's floating help button — present on every (dashboard) page
 * (see app/(dashboard)/layout.tsx, which only renders it at all when
 * the "assistant" module is enabled AND ANTHROPIC_API_KEY is
 * configured; otherwise this component is never mounted, not just
 * hidden). Positioned clear of MobileActionBar's bottom bar on
 * mobile — same `bottom-20 lg:bottom-6` offset the rest of the app
 * uses for anything that must float above it.
 */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relayNotice, setRelayNotice] = useState<{ recipientLabel: string; emergencyPhone: string | null } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && !loaded) {
      fetch("/api/assistant/conversation")
        .then((r) => r.json())
        .then((json) => {
          if (Array.isArray(json.messages)) setMessages(json.messages);
          setLoaded(true);
        })
        .catch(() => setLoaded(true));
    }
  }, [open, loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setRelayNotice(null);
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: "user", content: text, needs_human: null, feedback: null, created_at: new Date().toISOString() }]);
    setInput("");
    try {
      const res = await fetch("/api/assistant/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setMessages((prev) => [
        ...prev,
        { id: json.messageId, role: "assistant", content: json.answer, needs_human: json.needsHuman, feedback: null, created_at: new Date().toISOString() },
      ]);
      if (json.relay) setRelayNotice(json.relay);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function escalate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant/escalate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setRelayNotice(json.relay);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function vote(messageId: string, useful: boolean) {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, feedback: useful } : m)));
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

  return (
    <>
      <button
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-teal text-2xl shadow-[0_4px_16px_-4px_rgba(27,228,193,0.6)] lg:bottom-6"
        onClick={() => setOpen((v) => !v)}
        aria-label="Assistant GODAC"
      >
        {open ? "✕" : "💬"}
      </button>

      {open && (
        <div className="fixed bottom-[9.5rem] right-4 z-40 flex h-[28rem] w-[min(92vw,22rem)] flex-col overflow-hidden rounded-2xl border border-navy/10 bg-white shadow-2xl lg:bottom-24">
          <div className="border-b border-navy/10 bg-navy/5 p-3">
            <p className="font-display text-sm font-extrabold">Assistant GODAC</p>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
            {!loaded ? (
              <p className="text-sm text-navy/40">Chargement…</p>
            ) : messages.length === 0 ? (
              <p className="text-sm text-navy/40">Pose une question sur l&apos;utilisation de GODAC ou les consignes de ton entreprise.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        m.role === "user" ? "bg-teal/20 text-navy" : "bg-navy/5 text-navy"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.content}</p>
                      {m.role === "assistant" && !m.id.startsWith("tmp-") && (
                        <div className="mt-1.5 flex gap-2">
                          <button
                            className={`text-xs ${m.feedback === true ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
                            onClick={() => vote(m.id, true)}
                          >
                            👍
                          </button>
                          <button
                            className={`text-xs ${m.feedback === false ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
                            onClick={() => vote(m.id, false)}
                          >
                            👎
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && <p className="text-xs text-navy/40">L&apos;assistant écrit…</p>}
              </div>
            )}
            {relayNotice && (
              <div className="mt-3 rounded-lg bg-gold/10 p-3 text-sm text-gold-ink">
                <p>Ta question est transmise à {relayNotice.recipientLabel}. Tu seras prévenu de la réponse ici.</p>
                {relayNotice.emergencyPhone && (
                  <p className="mt-1">
                    Urgent ?{" "}
                    <a className="underline" href={`tel:${relayNotice.emergencyPhone}`}>
                      Appeler {relayNotice.emergencyPhone}
                    </a>
                  </p>
                )}
              </div>
            )}
            {error && <p className="mt-2 text-sm text-orange-ink">{error}</p>}
          </div>

          <div className="border-t border-navy/10 p-3">
            <div className="flex gap-2">
              <input
                className="input flex-1 !py-2 text-sm"
                value={input}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Écris ta question…"
                disabled={busy}
                onKeyDown={(e) => e.key === "Enter" && send()}
                onChange={(e) => setInput(e.target.value)}
              />
              <button className="btn-primary !px-3 !py-2 text-sm" disabled={busy || !input.trim()} onClick={send}>
                Envoyer
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button className="text-xs text-navy/50 underline" disabled={busy} onClick={escalate}>
                Parler à quelqu&apos;un
              </button>
              <span className="text-[10px] text-navy/30">{input.length}/{MAX_MESSAGE_LENGTH}</span>
            </div>
            <p className="mt-1.5 text-[10px] text-navy/30">
              Assistant automatique. Ne saisis pas d&apos;informations personnelles sensibles.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
