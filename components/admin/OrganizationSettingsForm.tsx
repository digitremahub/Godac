"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { textSafeVariant } from "@/lib/theme/contrast";
import { IconMapPin, IconNavigation } from "@/components/layout/icons";
import { PAYS, paysDe, type CodePays } from "@/lib/pays/pays";
import { ReglesPays } from "@/components/admin/ReglesPays";

const DEFAULT_ACCENT = "#1BE4C1";

export function OrganizationSettingsForm({
  organizationId,
  name,
  ocrEnabled,
  logoUrl,
  accentColor,
  requireOdometerPhoto,
  autoClockEnabled,
  emergencyPhone,
  consumptionAnomalyThresholdPercent,
  depotAddress,
  siret,
  legalAddress,
  legalForm,
  apeCode,
  conventionCollective,
  urssafNumber,
  country,
}: {
  organizationId: string;
  name: string;
  ocrEnabled: boolean;
  logoUrl: string | null;
  accentColor: string | null;
  requireOdometerPhoto: boolean;
  autoClockEnabled: boolean;
  emergencyPhone: string | null;
  consumptionAnomalyThresholdPercent: number;
  depotAddress: string | null;
  siret: string | null;
  legalAddress: string | null;
  legalForm: string | null;
  apeCode: string | null;
  conventionCollective: string | null;
  urssafNumber: string | null;
  country: string;
}) {
  const router = useRouter();
  const [orgName, setOrgName] = useState(name);
  const [ocr, setOcr] = useState(ocrEnabled);
  const [logo, setLogo] = useState(logoUrl);
  const [accent, setAccent] = useState(accentColor ?? DEFAULT_ACCENT);
  const [odometerPhotoRequired, setOdometerPhotoRequired] = useState(requireOdometerPhoto);
  const [autoClock, setAutoClock] = useState(autoClockEnabled);
  const [emergencyPhoneValue, setEmergencyPhoneValue] = useState(emergencyPhone ?? "");
  const [consumptionThreshold, setConsumptionThreshold] = useState(String(consumptionAnomalyThresholdPercent));
  const [depotAddressValue, setDepotAddressValue] = useState(depotAddress ?? "");
  const [siretValue, setSiretValue] = useState(siret ?? "");
  const [legalAddressValue, setLegalAddressValue] = useState(legalAddress ?? "");
  const [legalFormValue, setLegalFormValue] = useState(legalForm ?? "");
  const [apeCodeValue, setApeCodeValue] = useState(apeCode ?? "");
  const [conventionCollectiveValue, setConventionCollectiveValue] = useState(conventionCollective ?? "");
  const [urssafNumberValue, setUrssafNumberValue] = useState(urssafNumber ?? "");
  const [paysValue, setPaysValue] = useState<CodePays>(paysDe(country).code);
  const pays = paysDe(paysValue);
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
          auto_clock_enabled: autoClock,
          emergency_phone: emergencyPhoneValue.trim() || null,
          consumption_anomaly_threshold_percent: Number(consumptionThreshold) || 20,
          depot_address: depotAddressValue.trim() || null,
          siret: siretValue.trim() || null,
          legal_address: legalAddressValue.trim() || null,
          legal_form: legalFormValue.trim() || null,
          ape_code: apeCodeValue.trim() || null,
          convention_collective: conventionCollectiveValue.trim() || null,
          urssaf_number: urssafNumberValue.trim() || null,
          country: paysValue,
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
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {saved && <p role="status" className="text-sm text-teal-ink">Modifications enregistrées.</p>}

      <div>
        <label className="block"><span className="label">Nom de l&apos;organisation</span>
        <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} /></label>
      </div>

      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="label">Pays de l&apos;entreprise</span>
          <select className="input" value={paysValue} onChange={(e) => setPaysValue(e.target.value as CodePays)}>
            {PAYS.map((p) => (
              <option key={p.code} value={p.code}>
                {p.drapeau} {p.nom}
              </option>
            ))}
          </select>
        </label>
        <ReglesPays pays={pays} />
      </div>

      <div>
        <p className="label">Logo</p>
        <div className="flex items-center gap-4">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img width={56} height={56} src={logo} alt="Logo de l'organisation" className="h-14 w-14 rounded-lg object-contain bg-navy/[0.04] p-1" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-navy/[0.04] text-xs text-navy/60">
              Aucun
            </div>
          )}
          <label className="btn-secondary cursor-pointer !px-3 !py-1.5">
            {uploadingLogo ? "Envoi…" : "Changer le logo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="sr-only"
              disabled={uploadingLogo}
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="org-accent-color">Couleur d&apos;accent</label>
        <div className="flex items-center gap-3">
          <input
            id="org-accent-color"
            type="color"
            className="h-10 w-14 cursor-pointer rounded-lg border border-navy/15 bg-transparent"
            value={accent}
            onChange={(e) => setAccent(e.target.value)}
          />
          <span className="text-sm text-navy/65">{accent}</span>
        </div>
        <div className="mt-3 flex flex-col gap-2 rounded-lg bg-navy/[0.04] p-3 text-sm">
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

      <div className="flex items-center justify-between rounded-lg bg-navy/[0.04] p-3">
        <div>
          <p className="font-medium">Module OCR</p>
          <p className="text-sm text-navy/65">
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

      <div className="flex items-center justify-between rounded-lg bg-navy/[0.04] p-3">
        <div>
          <p className="font-medium">Photo du compteur kilométrique obligatoire</p>
          <p className="text-sm text-navy/65">
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

      <div className="flex items-center justify-between gap-4 rounded-lg bg-navy/[0.04] p-3">
        <div>
          <p className="font-medium">Pointage assisté par géolocalisation</p>
          <p className="text-sm text-navy/65">
            À l&apos;ouverture de l&apos;application, un salarié à moins de 300&nbsp;m du dépôt de son service est pointé
            automatiquement (annulable) ; la sortie lui est proposée en fin de journée. La position n&apos;est lue qu&apos;à ce
            moment, jamais en continu. Informez vos salariés avant d&apos;activer (règles CNIL sur la géolocalisation).
            Nécessite le module Pointeuse et l&apos;adresse du dépôt de chaque service.
          </p>
        </div>
        <button
          type="button"
          aria-pressed={autoClock}
          className={autoClock ? "btn-primary shrink-0 !px-3 !py-1.5" : "btn-secondary shrink-0 !px-3 !py-1.5"}
          onClick={() => setAutoClock((v) => !v)}
        >
          {autoClock ? "Activé" : "Désactivé"}
        </button>
      </div>

      <div>
        <label className="block"><span className="label">Numéro à appeler en cas d&apos;accident</span>
        <input
          className="input"
          type="tel"
          placeholder="ex: 06 12 34 56 78"
          value={emergencyPhoneValue}
          onChange={(e) => setEmergencyPhoneValue(e.target.value)}
        /></label>
        <p className="mt-1 text-sm text-navy/65">
          Affiché aux chauffeurs sur le formulaire de signalement. Laissez vide pour masquer le bandeau.
        </p>
      </div>

      <div>
        <label className="block"><span className="label">Adresse du dépôt</span>
        <input
          className="input"
          placeholder="ex: 1 rue du Dépôt, 69007 Lyon"
          value={depotAddressValue}
          onChange={(e) => setDepotAddressValue(e.target.value)}
        /></label>
        {depotAddressValue.trim() && (
          <p className="mt-1 flex gap-3 text-sm">
            <a
              href={`https://www.google.com/maps?q=${encodeURIComponent(depotAddressValue.trim())}`}
              target="_blank"
              rel="noreferrer"
              className="text-teal-ink underline"
            >
              <IconMapPin className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Google Maps
            </a>
            <a
              href={`https://waze.com/ul?q=${encodeURIComponent(depotAddressValue.trim())}&navigate=yes`}
              target="_blank"
              rel="noreferrer"
              className="text-teal-ink underline"
            >
              <IconNavigation className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Waze
            </a>
          </p>
        )}
        <p className="mt-1 text-sm text-navy/65">
          Sert à estimer la distance d&apos;un retour direct à domicile par rapport au retour habituel au dépôt
          (rentabilité carburant).
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-lg bg-navy/[0.04] p-3">
        <p className="font-medium">Identité légale (fiche employeur)</p>
        <p className="text-sm text-navy/65">
          Affichée dans l&apos;encadré employeur des fiches de paie générées — chaque champ renseigné y apparaît, les champs vides sont simplement omis.
        </p>

        <div>
          <label className="block"><span className="label">Forme juridique</span>
          <input className="input" placeholder="ex: SARL, SAS, EURL…" value={legalFormValue} onChange={(e) => setLegalFormValue(e.target.value)} /></label>
        </div>

        <div>
          <label className="block"><span className="label">{pays.identifiants.entreprise}</span>
          <input className="input" placeholder={`ex: ${pays.identifiants.exempleEntreprise}`} value={siretValue} onChange={(e) => setSiretValue(e.target.value)} /></label>
        </div>

        {pays.code === "FR" && (
          <>
        <div>
          <label className="block"><span className="label">Code APE/NAF</span>
          <input className="input" placeholder="ex: 4941A" value={apeCodeValue} onChange={(e) => setApeCodeValue(e.target.value)} /></label>
        </div>

        <div>
          <label className="block"><span className="label">Convention collective applicable</span>
          <input
            className="input"
            placeholder="ex: Transports routiers (IDCC 1340)"
            value={conventionCollectiveValue}
            onChange={(e) => setConventionCollectiveValue(e.target.value)}
          /></label>
        </div>
          </>
        )}

        <div>
          <label className="block"><span className="label">{pays.identifiants.cotisant}</span>
          <input className="input" value={urssafNumberValue} onChange={(e) => setUrssafNumberValue(e.target.value)} /></label>
        </div>

        <div>
          <label className="block"><span className="label">Adresse légale (siège social)</span>
          <input
            className="input"
            placeholder="ex: 60 rue Laennec, 93700 Drancy"
            value={legalAddressValue}
            onChange={(e) => setLegalAddressValue(e.target.value)}
          /></label>
          <p className="mt-1 text-sm text-navy/65">
            Distincte de l&apos;adresse du dépôt ci-dessus si votre siège social est ailleurs.
          </p>
        </div>
      </div>

      <div>
        <label className="label" htmlFor="org-consumption-threshold">Seuil d&apos;alerte de surconsommation</label>
        <div className="flex items-center gap-2">
          <input
            id="org-consumption-threshold"
            className="input !w-24"
            type="number"
            min={1}
            max={200}
            value={consumptionThreshold}
            onChange={(e) => setConsumptionThreshold(e.target.value)}
          />
          <span className="text-sm text-navy/65">% au-dessus de la moyenne 90 jours du véhicule</span>
        </div>
      </div>

      <button className="btn-primary" disabled={busy || uploadingLogo} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </Card>
  );
}
