"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Validation ou refus d'un ou plusieurs bulletins par la direction
 * (POST /api/paie/bulletins/validation). Un refus exige un commentaire,
 * renvoyé au comptable.
 */
export function ValidationBulletins({ ids, libelleValider = "Valider", compact = false }: { ids: string[]; libelleValider?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function decider(decision: "valider" | "refuser") {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/paie/bulletins/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, decision, commentaire: decision === "refuser" ? commentaire : null }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      const n = (json.traites as string[] | undefined)?.length ?? 0;
      setMessage({ ok: true, text: decision === "valider" ? `${n} bulletin${n > 1 ? "s" : ""} validé${n > 1 ? "s" : ""}.` : "Bulletin renvoyé au comptable." });
      setRefusOuvert(false);
      setCommentaire("");
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Erreur inattendue" });
    } finally {
      setBusy(false);
    }
  }

  if (ids.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`btn-primary ${compact ? "!px-3 !py-1.5 text-sm" : "!py-2"}`} disabled={busy} onClick={() => decider("valider")}>
          {busy ? "…" : libelleValider}
        </button>
        {ids.length === 1 && (
          <button type="button" className={`btn-secondary ${compact ? "!px-3 !py-1.5 text-sm" : "!py-2"}`} disabled={busy} onClick={() => setRefusOuvert((o) => !o)}>
            Refuser
          </button>
        )}
      </div>
      {refusOuvert && (
        <div className="flex flex-col gap-2">
          <label className="block">
            <span className="label">Motif du refus (transmis au comptable)</span>
            <textarea className="input min-h-[4.5rem]" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={2000} />
          </label>
          <button type="button" className="btn-secondary w-fit !py-1.5 text-sm" disabled={busy || !commentaire.trim()} onClick={() => decider("refuser")}>
            Confirmer le refus
          </button>
        </div>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

const STYLE: Record<string, string> = {
  en_attente: "bg-gold/25 text-navy",
  valide: "bg-teal/15 text-teal-ink",
  refuse: "bg-orange/15 text-orange-ink",
};
const LIBELLE: Record<string, string> = {
  en_attente: "En attente de validation",
  valide: "Validé",
  refuse: "Refusé",
};

export function BadgeValidation({ statut }: { statut: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[statut] ?? STYLE.en_attente}`}>{LIBELLE[statut] ?? LIBELLE.en_attente}</span>;
}
