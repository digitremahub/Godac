"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { ROLE_LABELS } from "@/lib/roles/labels";
import type { UserRole } from "@/lib/types/domain";

interface Note {
  id: string;
  title: string;
  content: string;
  roles: UserRole[];
}

const ROLES: UserRole[] = ["chauffeur", "manager", "manager_chauffeur", "comptable", "direction"];

/**
 * Lot B: consignes propres à l'entreprise (que faire en cas
 * d'accrochage, où faire le plein, qui appeler...) — données que
 * l'assistant peut citer en plus du guide d'utilisation statique,
 * filtrées par rôle avant d'être envoyées à l'IA (voir
 * app/api/assistant/message).
 */
export function AssistantNotesPanel({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRole(role: UserRole) {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/assistant-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, roles }),
      });
      if (!res.ok) throw new Error("Erreur");
      setTitle("");
      setContent("");
      setRoles([]);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Supprimer cette note ?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assistant-notes/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg">Consignes pour l&apos;assistant</h3>
        <p className="mt-1 text-sm text-navy/65">
          Ex : que faire en cas d&apos;accrochage, où faire le plein, qui appeler pour une panne. Visible par l&apos;assistant
          en plus du guide d&apos;utilisation — ne cochez aucun rôle pour la rendre visible par tous.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}

      <div className="flex flex-col gap-2 rounded-lg bg-navy/[0.04] p-3">
        <input className="input" aria-label="Titre" placeholder="Titre" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={3} aria-label="Contenu" placeholder="Contenu" value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="flex flex-wrap gap-2">
          {ROLES.map((r) => (
            <label key={r} className="flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={roles.includes(r)} onChange={() => toggleRole(r)} />
              {ROLE_LABELS[r]}
            </label>
          ))}
        </div>
        <button className="btn-primary self-start !px-3 !py-1.5 text-xs" disabled={busy || !title || !content} onClick={create}>
          Ajouter la consigne
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {notes.map((n) => (
          <div key={n.id} className="flex items-start justify-between gap-3 rounded-lg border border-navy/10 p-3 text-sm">
            <div>
              <p className="font-medium">{n.title}</p>
              <p className="text-navy/70">{n.content}</p>
              <p className="mt-1 text-xs text-navy/60">
                {n.roles.length === 0 ? "Tous les rôles" : n.roles.map((r) => ROLE_LABELS[r]).join(", ")}
              </p>
            </div>
            <button className="shrink-0 text-xs text-orange-ink underline" disabled={busy} onClick={() => remove(n.id)}>
              Supprimer
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}
