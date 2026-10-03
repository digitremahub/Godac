"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { textSafeVariant } from "@/lib/theme/contrast";

const DEFAULT_ACCENT = "#1BE4C1";

export function OrganizationSettingsForm({
  organizationId,
  name,
  ocrEnabled,
  logoUrl,
  accentColor,
  requireOdometerPhoto,
  emergencyPhone,
  consumptionAnomalyThresholdPercent,
  depotAddress,
}: {
  organizationId: string;
  name: string;
  ocrEnabled: boolean;
  logoUrl: string | null;
  accentColor: string | null;
  requireOdometerPhoto: boolean;
  emergencyPhone: string | null;
  consumptionAnomalyThresholdPercent: number;
  depotAddress: string | null;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [ocr, setOcr] = useState(ocrEnabled);
  const [logo, setLogo] = useState(logoUrl);
  const [accent, setAccent] = useState(accentColor ?? DEFAULT_ACCENT);
  const [odometerPhotoRequired, setOdometerPhotoRequired] = useState(requireOdometerPhoto);
  const [emergencyPhoneValue, setEmergencyPhoneValue] = useState(emergencyPhone ?? "");
  const [consumptionThreshold, setConsumptionThreshold] = useState(String(consumptionAnomalyThresholdPercent));
  const [depotAddressValue, setDepotAddressValue] = useState(depotAddress ?? "");
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
        body: JSON.stringify({
          name: orgName,
          ocr_enabled: ocr,
          logo_url: logo,
          accent_color: accent,
          require_odometer_photo: odometerPhotoRequired,
          emergency_phone: emergencyPhoneValue.trim() || null,
          consumption_anomaly_threshold_percent: Number(consumptionThreshold) || 20,
          depot_address: depotAddressValue.trim() || null,
        }),
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
      {error && <p className="text-sm text-orange-ink">{error}</p>}
      {saved && <p className="text-sm text-teal-ink">Modifications enregistrées.</p>}

      <div>
        <label className="label">Nom de l&apos;organisation</label>
        <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </div>

      <div>
        <label className="label">Logo</label>
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="Logo de l'organisation" className="h-14 w-14 rounded-lg object-contain bg-navy/5 p-1" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-navy/5 text-xs text-navy/30">
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
            className="h-10 w-14 cursor-pointer rounded-lg border border-navy/15 bg-transparent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
          <span className="text-sm text-navy/50">{accent}</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-navy/5 p-3 text-sm">
          <div className="flex items-center gap-2">
            <span className="h-5 w-5 shrink-0 rounded" style={{ backgroundColor: accent }} />
            Sur les boutons et badges — votre couleur exacte.
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold" style={{ color: textSafeVariant(accent) }}>
              Aa
            </span>
            Utilisée comme texte (menu actif…) — assombrie automatiquement si besoin pour rester lisible.
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg bg-navy/5 p-3">
        <div>
          <p className="font-medium">Module OCR</p>
          <p className="text-sm text-navy/50">
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

      <div className="flex items-center justify-between rounded-lg bg-navy/5 p-3">
        <div>
          <p className="font-medium">Photo du compteur kilométrique obligatoire</p>
          <p className="text-sm text-navy/50">
            Activé, un chauffeur ne peut plus valider un départ/retour de tournée sans photo du compteur.
          </p>
        </div>
        <button
          className={odometerPhotoRequired ? "btn-primary !px-3 !py-1.5" : "btn-secondary !px-3 !py-1.5"}
          onClick={() => setOdometerPhotoRequired((v) => !v)}
        >
          {odometerPhotoRequired ? "Activé" : "Désactivé"}
        </button>
      </div>

      <div>
        <label className="label">Numéro à appeler en cas d&apos;accident</label>
        <input
          className="input"
          type="tel"
          placeholder="ex: 06 12 34 56 78"
          value={emergencyPhoneValue}
          onChange={(e) => setEmergencyPhoneValue(e.target.value)}
        />
        <p className="mt-1 text-sm text-navy/50">
          Affiché aux chauffeurs sur le formulaire de signalement. Laissez vide pour masquer le bandeau.
        </p>
      </div>

      <div>
        <label className="label">Adresse du dépôt</label>
        <input
          className="input"
          placeholder="ex: 1 rue du Dépôt, 69007 Lyon"
          value={depotAddressValue}
          onChange={(e) => setDepotAddressValue(e.target.value)}
        />
        <p className="mt-1 text-sm text-navy/50">
          Sert à estimer la distance d&apos;un retour direct à domicile par rapport au retour habituel au dépôt
          (rentabilité carburant).
        </p>
      </div>

      <div>
        <label className="label">Seuil d&apos;alerte de surconsommation</label>
        <div className="flex items-center gap-2">
          <input
            className="input !w-24"
            type="number"
            min={1}
            max={200}
            value={consumptionThreshold}
            onChange={(e) => setConsumptionThreshold(e.target.value)}
          />
          <span className="text-sm text-navy/50">% au-dessus de la moyenne 90 jours du véhicule</span>
        </div>
      </div>

      <button className="btn-primary" disabled={busy || uploadingLogo} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
