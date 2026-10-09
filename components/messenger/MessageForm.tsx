"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export function MessageForm({ recipientId, senderId, organizationId }: { recipientId: string; senderId: string; organizationId: string }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [photo, setPhoto] = useState<{ file: File; previewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickPhoto(file: File) {
    setPhoto({ file, previewUrl: URL.createObjectURL(file) });
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhoto(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function send() {
    if (!body.trim() && !photo) return;
    setBusy(true);
    setError(null);
    try {
      let photo_path: string | undefined;
      if (photo) {
        photo_path = `${organizationId}/${senderId}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage.from("messenger-photos").upload(photo_path, photo.file, {
          contentType: photo.file.type,
        });
        if (uploadError) throw new Error(`Envoi de la photo échoué: ${uploadError.message}`);
      }

      const res = await fetch("/api/messenger/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: recipientId, body: body.trim() || undefined, photo_path }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setBody("");
      clearPhoto();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {error && <p className="text-xs text-orange-ink">{error}</p>}
      {photo && (
        <div className="flex items-center gap-2">
          <img src={photo.previewUrl} alt="Photo à envoyer" className="h-16 w-16 rounded-lg object-cover" />
          <button className="text-xs text-navy/40 underline" disabled={busy} onClick={clearPhoto}>
            Retirer
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <label className="btn-secondary shrink-0 cursor-pointer !px-3">
          📷
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files?.[0] && pickPhoto(e.target.files[0])}
          />
        </label>
        <input
          className="input flex-1"
          placeholder="Votre message…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          disabled={busy}
        />
        <button className="btn-primary shrink-0" disabled={busy || (!body.trim() && !photo)} onClick={send}>
          {busy ? "…" : "Envoyer"}
        </button>
      </div>
    </div>
  );
}
