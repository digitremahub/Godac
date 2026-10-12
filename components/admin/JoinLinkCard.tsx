"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Card } from "@/components/ui";
import { IconCheck } from "@/components/layout/icons";

/**
 * Direction-only (see app/(dashboard)/admin/organizations/page.tsx —
 * the token is only ever passed into this component when
 * appUser.role === 'direction'). One reusable link/QR for the whole
 * organization, printed once at the depot — not per-driver like the
 * Lot 7 badge, see app/join/[token].
 */
export function JoinLinkCard({ token }: { token: string }) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const url = typeof window !== "undefined" ? `${window.location.origin}/join/${token}` : `/join/${token}`;

  useEffect(() => {
    if (canvasRef.current) QRCode.toCanvas(canvasRef.current, url, { width: 180, margin: 1 });
  }, [url]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function regenerate() {
    if (!window.confirm("Régénérer ce lien ? L'ancien lien/QR ne fonctionnera plus — il faudra réimprimer le nouveau.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizations/driver-signup-token", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <p className="text-sm font-medium">Auto-inscription chauffeur</p>
      <p className="text-xs text-navy/60">
        Un seul lien/QR à afficher au dépôt — chaque nouveau chauffeur le scanne pour créer lui-même son compte. Son
        compte reste en attente jusqu&apos;à validation par un chef de service ou la direction (voir &quot;Chauffeurs à
        valider&quot;).
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <canvas ref={canvasRef} role="img" aria-label="QR code du lien d’inscription chauffeur" className="rounded-lg border border-navy/10" />
        <div className="flex flex-1 flex-col gap-2">
          <code className="break-all rounded-xl bg-navy/[0.035] px-3.5 py-2.5 text-xs">{url}</code>
          <div className="flex gap-2">
            <button className="btn-secondary !px-3 !py-1.5 text-xs" onClick={copy}>
              {copied ? <>Copié <IconCheck className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /></> : "Copier le lien"}
            </button>
            <button className="btn-secondary !px-3 !py-1.5 text-xs text-orange-ink" disabled={busy} onClick={regenerate}>
              {busy ? "…" : "Régénérer"}
            </button>
          </div>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
    </Card>
  );
}
