"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconCamera } from "@/components/layout/icons";
import { networkErrorMessage } from "@/lib/utils/network-error";

export interface CommentaireVue {
  id: string;
  auteur: string;
  auteurId: string | null;
  texte: string;
  photos: number;
  creeLe: string;
}

const quand = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Échanges sur une amende ou une contestation : explication et photos du
 * chauffeur, réponses de l'encadrement. `api` : « /api/fines/<id> » ou
 * « /api/contestations/<id> » ; `routePiece` : sous-route qui signe le lien
 * d'une photo (« piece » pour les amendes, « document » pour les contestations).
 */
export function Commentaires({
  api,
  routePiece,
  commentaires,
  moi,
  placeholder,
  libelleEnvoi = "Envoyer",
  ouvert = true,
}: {
  api: string;
  routePiece: "piece" | "document";
  commentaires: CommentaireVue[];
  moi: string;
  placeholder: string;
  libelleEnvoi?: string;
  ouvert?: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [texte, setTexte] = useState("");
  const [fichiers, setFichiers] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function envoyer() {
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("texte", texte);
      for (const f of fichiers) fd.append("photos", f);
      const res = await fetch(`${api}/commentaires`, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Envoi impossible");
      setTexte("");
      setFichiers([]);
      if (fileRef.current) fileRef.current.value = "";
      setMessage({ ok: true, text: "Envoyé." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {commentaires.length > 0 && (
        <ul className="flex flex-col gap-2">
          {commentaires.map((c) => (
            <li key={c.id} className={`rounded-xl p-3 text-sm ${c.auteurId === moi ? "bg-teal/[0.07]" : "bg-navy/[0.04]"}`}>
              <p className="text-xs font-semibold text-navy/60">
                {c.auteur} · {quand(c.creeLe)}
              </p>
              {c.texte && <p className="mt-1 whitespace-pre-line">{c.texte}</p>}
              {c.photos > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {Array.from({ length: c.photos }, (_, i) => (
                    <a key={i} href={`${api}/${routePiece}?commentaire=${c.id}&i=${i}`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs text-teal-ink">
                      📷 Photo {i + 1}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {ouvert && (
        <div className="flex flex-col gap-2">
          <textarea className="input min-h-[80px]" value={texte} onChange={(e) => setTexte(e.target.value)} placeholder={placeholder} />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => setFichiers(Array.from(e.target.files ?? []).slice(0, 3))}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              <IconCamera className="h-4 w-4" /> {fichiers.length ? `${fichiers.length} photo${fichiers.length > 1 ? "s" : ""}` : "Ajouter une photo"}
            </button>
            <button type="button" className="btn-primary !py-2 text-sm" disabled={busy || (!texte.trim() && fichiers.length === 0)} onClick={envoyer}>
              {busy ? "Envoi…" : libelleEnvoi}
            </button>
          </div>
          {message && (
            <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const CONFIANCE: Record<string, { label: string; cls: string }> = {
  exact: { label: "Exact", cls: "bg-teal/15 text-teal-ink" },
  probable: { label: "Probable", cls: "bg-gold/25 text-navy" },
  aucun: { label: "Aucun", cls: "bg-navy/[0.06] text-navy/70" },
};

/** Indice de confiance du rapprochement. */
export function BadgeConfiance({ confiance }: { confiance: string | null }) {
  if (!confiance) return null;
  const c = CONFIANCE[confiance] ?? CONFIANCE.aucun!;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${c.cls}`}>Confiance : {c.label}</span>;
}
