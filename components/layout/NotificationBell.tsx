"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconBell, IconCalendar, IconChatBubble, IconWrench, IconAlertTriangle } from "@/components/layout/icons";

interface Item {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
  href: string;
  read: boolean;
}

const POLL_MS = 30000;

function iconFor(type: string) {
  if (type.startsWith("planning")) return IconCalendar;
  if (type === "new_message" || type === "group_message") return IconChatBubble;
  if (type.startsWith("maintenance") || type.startsWith("vehicle")) return IconWrench;
  return IconAlertTriangle;
}

function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short" });
}

/**
 * Bell in the top bar: every planning, maintenance and Messenger event
 * (and any other alert) for the signed-in user, with an unread count —
 * polled every 30 s, the same no-realtime approach as the chat widget.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.items ?? []);
      setUnread(json.unread ?? 0);
    } catch {
      // offline — keep the last list
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function markRead(ids: string[]) {
    if (ids.length === 0) return;
    setItems((prev) => prev.map((i) => (ids.includes(i.id) ? { ...i, read: true } : i)));
    setUnread((u) => Math.max(0, u - ids.length));
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => undefined);
  }

  async function openItem(item: Item) {
    if (!item.read) await markRead([item.id]);
    setOpen(false);
    router.push(item.href);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications — ${unread} non lue${unread > 1 ? "s" : ""}` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-xl text-navy/70 transition-colors hover:bg-navy/[0.06] hover:text-navy"
      >
        <IconBell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-orange px-1 text-[11px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-3 top-[4.25rem] z-50 flex max-h-[70vh] flex-col overflow-hidden rounded-2xl border border-navy/10 bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-navy/[0.08] px-4 py-3">
            <p className="font-semibold">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                className="text-sm font-semibold text-teal-ink hover:underline"
                onClick={() => markRead(items.filter((i) => !i.read).map((i) => i.id))}
              >
                Tout marquer comme lu
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-navy/60">Aucune notification pour le moment.</p>
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-navy/[0.06] overflow-y-auto overscroll-contain">
              {items.map((item) => {
                const Icon = iconFor(item.type);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-navy/[0.03] ${item.read ? "" : "bg-teal/[0.06]"}`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                          item.severity === "critical" ? "bg-orange/15 text-orange-ink" : "bg-marine text-teal"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm leading-snug ${item.read ? "text-navy/70" : "font-semibold"}`}>{item.message}</span>
                        <span className="mt-0.5 block text-xs text-navy/55">{ago(item.createdAt)}</span>
                      </span>
                      {!item.read && <span aria-label="Non lue" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-orange" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <a href="/communication/alertes" className="border-t border-navy/[0.08] px-4 py-3 text-center text-sm font-semibold text-teal-ink hover:bg-navy/[0.03]">
            Voir toutes les alertes
          </a>
        </div>
      )}
    </div>
  );
}
