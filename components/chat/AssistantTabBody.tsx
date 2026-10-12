"use client";

import { useEffect, useRef } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/assistant/rate-limit";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  needs_human: boolean | null;
  feedback: boolean | null;
  created_at: string;
}

/** The old AssistantWidget's panel body, unchanged, now just one tab among several. */
export function AssistantTabBody({
  messages,
  loaded,
  input,
  busy,
  error,
  relayNotice,
  onInputChange,
  onSend,
  onEscalate,
  onVote,
}: {
  messages: AssistantMessage[];
  loaded: boolean;
  input: string;
  busy: boolean;
  error: string | null;
  relayNotice: { recipientLabel: string; emergencyPhone: string | null } | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onEscalate: () => void;
  onVote: (messageId: string, useful: boolean) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {!loaded ? (
          <p className="text-sm text-navy/60">Chargement…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-navy/60">Pose une question sur l&apos;utilisation de GODAC ou les consignes de ton entreprise.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "bg-teal/20 text-navy" : "bg-navy/5 text-navy"}`}>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                  {m.role === "assistant" && !m.id.startsWith("tmp-") && (
                    <div className="mt-1.5 flex gap-2">
                      <button
                        className={`text-xs ${m.feedback === true ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
                        onClick={() => onVote(m.id, true)}
                      >
                        👍
                      </button>
                      <button
                        className={`text-xs ${m.feedback === false ? "opacity-100" : "opacity-40 hover:opacity-100"}`}
                        onClick={() => onVote(m.id, false)}
                      >
                        👎
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <p className="text-xs text-navy/60">L&apos;assistant écrit…</p>}
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
            onKeyDown={(e) => e.key === "Enter" && onSend()}
            onChange={(e) => onInputChange(e.target.value)}
          />
          <button className="btn-primary !px-3 !py-2 text-sm" disabled={busy || !input.trim()} onClick={onSend}>
            Envoyer
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button className="text-xs text-navy/65 underline" disabled={busy} onClick={onEscalate}>
            Parler à quelqu&apos;un
          </button>
          <span className="text-[10px] text-navy/60">
            {input.length}/{MAX_MESSAGE_LENGTH}
          </span>
        </div>
        <p className="mt-1.5 text-[10px] text-navy/60">Assistant automatique. Ne saisis pas d&apos;informations personnelles sensibles.</p>
      </div>
    </div>
  );
}
