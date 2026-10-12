"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { IconFileText, IconPaperclip, IconTrash } from "@/components/layout/icons";
import { VEHICLE_DOC_TYPES, expiryStatus, type VehicleDocument } from "@/lib/vehicles/document-types";

const EXPIRY_BADGE = {
  expired: { cls: "badge-orange", label: "Expiré" },
  soon: { cls: "badge-gold", label: "Expire bientôt" },
  ok: { cls: "badge-teal", label: "À jour" },
} as const;

function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
}

/**
 * Exploitation side of « Papiers du véhicule »: upload (PDF/photo) to
 * the private vehicle-documents bucket, with an expiry date and a
 * « consultable par les chauffeurs » switch — the driver then opens it
 * from the scanned vehicle page during a roadside check, no request
 * needed (see VehiclePapersCard).
 */
export function VehicleDocumentsPanel({ vehicleId, documents, today }: { vehicleId: string; documents: VehicleDocument[]; today: string }) {
  const router = useRouter();
  const supabase = createBrowserSupabaseClient();
  const [docType, setDocType] = useState<(typeof VEHICLE_DOC_TYPES)[number]>(VEHICLE_DOC_TYPES[0]);
  const [expiresOn, setExpiresOn] = useState("");
  const [driverVisible, setDriverVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const initRes = await fetch(`/api/vehicles/${vehicleId}/documents/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: file.type }),
      });
      const initJson = await initRes.json();
      if (!initRes.ok) throw new Error(typeof initJson.error === "string" ? initJson.error : "Envoi impossible.");
      const { error: uploadError } = await supabase.storage
        .from("vehicle-documents")
        .upload(initJson.storagePath, file, { contentType: file.type });
      if (uploadError) throw new Error(`Envoi échoué : ${uploadError.message}`);
      const res = await fetch(`/api/vehicles/${vehicleId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType, filePath: initJson.storagePath, expiresOn: expiresOn || null, driverVisible }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible.");
      setExpiresOn("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur inattendue");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisible(doc: VehicleDocument) {
    setRowBusy(doc.id);
    await fetch(`/api/vehicles/${vehicleId}/documents/${doc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driverVisible: !doc.driverVisible }),
    });
    setRowBusy(null);
    router.refresh();
  }

  async function remove(doc: VehicleDocument) {
    if (!window.confirm(`Supprimer « ${doc.docType} » ?`)) return;
    setRowBusy(doc.id);
    await fetch(`/api/vehicles/${vehicleId}/documents/${doc.id}`, { method: "DELETE" });
    setRowBusy(null);
    router.refresh();
  }

  return (
    <Card>
      <h2 id="papiers" className="scroll-mt-24">
        Papiers du véhicule
      </h2>
      <p className="mt-1 text-sm text-navy/65">
        Les documents « consultables » s&apos;ouvrent directement depuis le QR du camion, par exemple lors d&apos;un contrôle routier.
      </p>

      {documents.length > 0 && (
        <ul className="mt-4 divide-y divide-navy/[0.08]">
          {documents.map((doc) => {
            const status = expiryStatus(doc.expiresOn, today);
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-3 py-3">
                <IconFileText className="h-5 w-5 shrink-0 text-navy/50" />
                <div className="min-w-0 flex-1">
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noreferrer" className="font-medium hover:text-teal-ink hover:underline">
                      {doc.docType}
                    </a>
                  ) : (
                    <span className="font-medium">{doc.docType}</span>
                  )}
                  <p className="text-xs text-navy/60">
                    {doc.expiresOn ? `Valable jusqu'au ${formatDate(doc.expiresOn)}` : "Sans date d'expiration"}
                  </p>
                </div>
                {status && <span className={EXPIRY_BADGE[status].cls}>{EXPIRY_BADGE[status].label}</span>}
                <button
                  type="button"
                  aria-pressed={doc.driverVisible}
                  disabled={rowBusy === doc.id}
                  onClick={() => toggleVisible(doc)}
                  className={doc.driverVisible ? "btn-secondary !px-3 !py-1.5 text-xs" : "btn-ghost !px-3 !py-1.5 text-xs"}
                  title="Consultable par les chauffeurs depuis le QR du camion"
                >
                  {doc.driverVisible ? "Consultable" : "Sur demande"}
                </button>
                <button
                  type="button"
                  disabled={rowBusy === doc.id}
                  onClick={() => remove(doc)}
                  aria-label={`Supprimer ${doc.docType}`}
                  className="btn-ghost !px-2 !py-1.5 hover:!text-orange-ink"
                >
                  <IconTrash className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl bg-navy/[0.035] p-4 sm:grid-cols-2">
        <label className="block">
          <span className="label">Type de document</span>
          <select className="input" value={docType} onChange={(e) => setDocType(e.target.value as (typeof VEHICLE_DOC_TYPES)[number])}>
            {VEHICLE_DOC_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Valable jusqu&apos;au (optionnel)</span>
          <input className="input" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </label>
        <label className="flex min-h-[44px] items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={driverVisible} onChange={(e) => setDriverVisible(e.target.checked)} />
          Consultable par les chauffeurs depuis le QR du camion
        </label>
        <label className="btn-primary cursor-pointer sm:col-span-2">
          <IconPaperclip className="h-4 w-4" />
          {busy ? "Envoi…" : "Ajouter le fichier (PDF ou photo)"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) upload(f);
            }}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-orange-ink sm:col-span-2">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
