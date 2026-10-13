"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Relit les scans enregistrés d'une tournée (app/api/reports/[id]/relire). */
export function RelireScansButton({ planningEntryId }: { planningEntryId: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "lecture" | "ok" | "erreur">("repos");
  const [message, setMessage] = useState<string | null>(null);

  async function relire() {
    setEtat("lecture");
    setMessage(null);
    try {
      const res = await fetch(`/api/reports/${planningEntryId}/relire`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      setEtat("ok");
      router.refresh();
    } catch (e) {
      setEtat("erreur");
      setMessage(e instanceof Error ? e.message : "Erreur inattendue");
    }
  }

  return (
    <>
      <button className="text-left text-xs text-teal-ink underline disabled:opacity-50" disabled={etat === "lecture"} onClick={relire}>
        {etat === "lecture" ? "Relecture…" : etat === "ok" ? "Scans relus ✓" : "Relire les scans"}
      </button>
      {message && <p role="alert" className="text-xs text-orange-ink">{message}</p>}
    </>
  );
}
