"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const DEFAULT_ACCENT = "#1BE4C1";

export function OrganizationSettingsForm({
  organizationId,
  name,
  ocrEnabled,
  logoUrl,
  accentColor,
}: {
  organizationId: string;
  name: string;
  ocrEnabled: boolean;
  logoUrl: string | null;
  accentColor: string | null;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [ocr, setOcr] = useState(ocrEnabled);
  const [logo, setLogo] = useState(logoUrl);
  const [accent, setAccent] = useState(accentColor ?? DEFAULT_ACCENT);
  const [busy, setBusy] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const extension = file.name.split(".").pop() || "png";
      const path = `${organizationId}/logo.${extension}`;
      const { error: uploadError } = await supabase.storage
        .from("org-logos")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (uploadError) throw new Error(`Envoi du logo échoué: ${uploadError.message}`);

      const { data } = supabase.storage.from("org-logos").getPublicUrl(path);
      // Cache-bust so the new logo shows up immediately after an
      // upsert to the same path (browsers/CDN would otherwise keep
      // serving the previous file at that exact URL).
      setLogo(`${data.publicUrl}?v=${Date.now()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName, ocr_enabled: ocr, logo_url: logo, accent_color: accent }),
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

      <div>
        <label className="label">Logo</label>
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Logo de l'organisation" className="h-14 w-14 rounded-lg object-contain bg-white/5 p-1" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/5 text-xs text-white/30">
              Aucun
            </div>
          )}
          <label className="btn-secondary cursor-pointer !px-3 !py-1.5">
            {uploadingLogo ? "Envoi…" : "Changer le logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              disabled={uploadingLogo}
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div>
        <label className="label">Couleur d&apos;accent</label>
        <div className="flex items-center gap-3">
          <input
            type="color"
            className="h-10 w-14 cursor-pointer rounded-lg border border-white/15 bg-transparent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
          <span className="text-sm text-white/50">{accent}</span>
        </div>
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

      <button className="btn-primary" disabled={busy || uploadingLogo} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
