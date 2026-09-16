"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";

export function OrganizationSettingsForm({ name, ocrEnabled }: { name: string; ocrEnabled: boolean }) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [ocr, setOcr] = useState(ocrEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName, ocr_enabled: ocr }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? JSON.stringify(json.error) ?? "Erreur");
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex max-w-lg flex-col gap-4">
      {error && <p className="text-sm text-orange">{error}</p>}
      {saved && <p className="text-sm text-teal">Modifications enregistrées.</p>}

      <div>
        <label className="label">Nom de l&apos;organisation</label>
        <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-white/5 p-3">
        <div>
          <p className="font-medium">Module OCR</p>
          <p className="text-sm text-white/50">
            Activable/désactivable par organisation — désactivé, tous les
            ravitaillements passent en saisie 100% manuelle.
          </p>
        </div>
        <button
          className={ocr ? "btn-primary !px-3 !py-1.5" : "btn-secondary !px-3 !py-1.5"}
          onClick={() => setOcr((v) => !v)}
        >
          {ocr ? "Activé" : "Désactivé"}
        </button>
      </div>

      <button className="btn-primary" disabled={busy} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
