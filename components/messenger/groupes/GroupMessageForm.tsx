"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconPaperclip } from "@/components/layout/icons";
import { normaliserNom, pieceJointeAcceptee } from "@/lib/messenger/groupes";

/**
 * Saisie d'un message de groupe : texte avec suggestions @prénom,
 * photo ou document (même bucket et même dossier que la messagerie
 * 1:1), et pour les responsables la case « Info équipe » (message
 * épinglé avec accusés « vu par X/Y »).
 */
export function GroupMessageForm({
  groupId,
  senderId,
  organizationId,
  canAnnounce,
  members,
}: {
  groupId: string;
  senderId: string;
  organizationId: string;
  canAnnounce: boolean;
  members: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mentionEnCours = /(?:^|\s)@([\p{L}'-]*)$/u.exec(body)?.[1];
  const suggestions =
    mentionEnCours !== undefined
      ? [
          ...(canAnnounce && "tous".startsWith(normaliserNom(mentionEnCours)) ? [{ id: "tous", label: "tous", hint: "tout le groupe" }] : []),
          ...members
            .filter((m) => m.id !== senderId && normaliserNom(m.full_name).startsWith(normaliserNom(mentionEnCours)))
            .slice(0, 5)
            .map((m) => ({ id: m.id, label: m.full_name.split(/\s+/)[0] ?? m.full_name, hint: m.full_name })),
        ]
      : [];

  function completer(label: string) {
    setBody((b) => b.replace(/@([\p{L}'-]*)$/u, `@${label} `));
  }

  function pick(f: File) {
    if (!pieceJointeAcceptee(f.type, f.size)) {
      setError("Fichier refusé : photo ou document (PDF, Word, Excel, texte) de 15 Mo maximum.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setError(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(f.type.startsWith("image/") ? URL.createObjectURL(f) : null);
    setFile(f);
  }

  function clearFile() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send() {
    if (!body.trim() && !file) return;
    setBusy(true);
    setError(null);
    try {
      let attachment: { attachment_path: string; attachment_name: string; attachment_type: string } | undefined;
      if (file) {
        const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
        const path = `${organizationId}/${senderId}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("messenger-photos").upload(path, file, { contentType: file.type });
        if (uploadError) throw new Error(`Envoi du fichier échoué : ${uploadError.message}`);
        attachment = { attachment_path: path, attachment_name: file.name.slice(0, 200), attachment_type: file.type };
      }
      const res = await fetch(`/api/messenger/groupes/${groupId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() || undefined, ...attachment, announcement: canAnnounce && announcement }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setBody("");
      setAnnouncement(false);
      clearFile();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p role="alert" className="text-xs text-orange-ink">{error}</p>}
      {file && (
        <div className="flex items-center gap-2 text-sm">
          {preview ? (
            <img width={64} height={64} src={preview} alt="Photo à envoyer" className="h-16 w-16 rounded-lg object-cover" />
          ) : (
            <span className="badge-neutral max-w-[60%] truncate">{file.name}</span>
          )}
          <button className="text-xs text-navy/60 underline" disabled={busy} onClick={clearFile}>
            Retirer
          </button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1" role="listbox" aria-label="Mentionner">
          {suggestions.map((s) => (
            <button key={s.id} type="button" className="badge-teal" onClick={() => completer(s.label)} title={s.hint}>
              @{s.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <label className="btn-secondary shrink-0 cursor-pointer !px-3" title="Photo ou document">
          <IconPaperclip className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" />
          <span className="sr-only">Joindre une photo ou un document</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            className="sr-only"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
          />
        </label>
        <input
          className="input min-w-0 flex-1"
          aria-label="Votre message"
          placeholder="Votre message… (@prénom pour mentionner)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) send();
          }}
          disabled={busy}
        />
        <button className="btn-primary shrink-0" disabled={busy || (!body.trim() && !file)} onClick={send}>
          {busy ? "…" : "Envoyer"}
        </button>
      </div>
      {canAnnounce && (
        <label className="flex items-center gap-2 text-xs text-navy/70">
          <input type="checkbox" checked={announcement} onChange={(e) => setAnnouncement(e.target.checked)} disabled={busy} />
          Publier en « Info équipe » (épinglée en haut du groupe, notifiée à tous, avec « vu par »)
        </label>
      )}
    </div>
  );
}
