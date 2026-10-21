"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { networkErrorMessage } from "@/lib/utils/network-error";

type Status = "suggested" | "published" | "dismissed";
const ROLES = [
  { key: "chauffeur", label: "Chauffeur" },
  { key: "manager", label: "Manager" },
  { key: "exploitation", label: "Exploitation" },
  { key: "comptable", label: "Comptable" },
  { key: "direction", label: "Direction" },
] as const;

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  roles: string[];
  status: Status;
  askedCount: number;
}

function Entry({ entry }: { entry: FaqEntry }) {
  const router = useRouter();
  const [question, setQuestion] = useState(entry.question);
  const [answer, setAnswer] = useState(entry.answer);
  const [roles, setRoles] = useState<string[]>(entry.roles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = question !== entry.question || answer !== entry.answer || roles.join() !== entry.roles.join();

  async function save(status?: Status) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/faq/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, answer, roles, ...(status ? { status } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Supprimer définitivement cette entrée ?")) return;
    setBusy(true);
    await fetch(`/api/admin/faq/${entry.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-navy/60">
        <span>
          Posée <strong className="text-navy">{entry.askedCount}</strong> fois
        </span>
        {!entry.answer && entry.status === "suggested" && <span className="rounded-full bg-gold/25 px-2 py-0.5 font-semibold text-navy">Réponse à rédiger</span>}
      </div>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Question
        <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Réponse
        <textarea className="input min-h-[110px]" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Rédigez la réponse que l'assistant donnera…" />
      </label>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <legend className="mb-1 text-xs text-navy/60">Visible pour (aucune case = tout le monde)</legend>
        {ROLES.map((r) => (
          <label key={r.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={roles.includes(r.key)}
              onChange={(e) => setRoles(e.target.checked ? [...roles, r.key] : roles.filter((x) => x !== r.key))}
            />
            {r.label}
          </label>
        ))}
      </fieldset>
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {entry.status !== "published" && (
          <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={() => save("published")}>
            Publier
          </button>
        )}
        {entry.status === "published" && dirty && (
          <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={() => save()}>
            Enregistrer
          </button>
        )}
        {entry.status !== "published" && dirty && (
          <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => save()}>
            Enregistrer le brouillon
          </button>
        )}
        {entry.status === "published" && (
          <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => save("suggested")}>
            Retirer de la FAQ
          </button>
        )}
        {entry.status === "suggested" && (
          <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => save("dismissed")}>
            Ignorer
          </button>
        )}
        {entry.status === "dismissed" && (
          <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => save("suggested")}>
            Remettre en attente
          </button>
        )}
        <button type="button" className="btn-ghost !py-2 text-sm text-orange-ink" disabled={busy} onClick={remove}>
          Supprimer
        </button>
      </div>
    </Card>
  );
}

const TABS: { key: Status; label: string }[] = [
  { key: "suggested", label: "À valider" },
  { key: "published", label: "Publiées" },
  { key: "dismissed", label: "Ignorées" },
];

export function FaqManager({ entries, pendingQuestions }: { entries: FaqEntry[]; pendingQuestions: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<Status>("suggested");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function suggest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/faq/suggest", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Analyse impossible");
      setMessage(json.message ?? `${json.analysed} question(s) analysée(s) : ${json.created} nouvelle(s) entrée(s), ${json.updated} mise(s) à jour.`);
      setTab("suggested");
      router.refresh();
    } catch (e) {
      setMessage(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const visible = entries.filter((e) => e.status === tab).sort((a, b) => b.askedCount - a.askedCount);

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-navy/70">
          <strong className="text-navy">{pendingQuestions}</strong> nouvelle(s) question(s) anonymisée(s) en attente d&apos;analyse, toutes
          entreprises confondues.
        </p>
        <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={suggest}>
          {busy ? "Analyse en cours…" : "Analyser et proposer des réponses"}
        </button>
        {message && <p className="w-full text-sm text-navy/70">{message}</p>}
      </Card>

      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            type="button"
            className={tab === t.key ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
            onClick={() => setTab(t.key)}
          >
            {t.label} ({entries.filter((e) => e.status === t.key).length})
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="text-sm text-navy/60">Rien ici pour le moment.</p>
      ) : (
        visible.map((e) => <Entry key={`${e.id}-${e.status}-${e.question}-${e.answer}`} entry={e} />)
      )}
    </div>
  );
}
