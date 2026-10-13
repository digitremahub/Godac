"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { PHOTOS_CHANGEMENT, type PhotoChangement, type TypeChangement, type TypePhotoChangement } from "@/lib/tours/changement-vehicule";
import { networkErrorMessage } from "@/lib/utils/network-error";

/**
 * Changement de véhicule : choix changement / dépannage, puis (hors
 * dépannage) les 6 photos d'état obligatoires du véhicule récupéré —
 * habitacle, tableau de bord et tour du véhicule.
 */
export function PhotosChangementVehicule({
  type,
  onType,
  photos,
  onPhotos,
}: {
  type: TypeChangement;
  onType: (t: TypeChangement) => void;
  photos: PhotoChangement[];
  onPhotos: (p: PhotoChangement[]) => void;
}) {
  const supabase = createBrowserSupabaseClient();
  const [envoi, setEnvoi] = useState<TypePhotoChangement | null>(null);
  const [apercus, setApercus] = useState<Partial<Record<TypePhotoChangement, string>>>({});
  const [erreur, setErreur] = useState<string | null>(null);

  async function prendre(kind: TypePhotoChangement, fichier: File) {
    setEnvoi(kind);
    setErreur(null);
    try {
      const init = await fetch("/api/tours/change-photos/init", { method: "POST" });
      const json = await init.json();
      if (!init.ok) throw new Error(typeof json.error === "string" ? json.error : "Erreur");
      const { error } = await supabase.storage.from("tour-photos").upload(json.storagePath, fichier, { contentType: fichier.type || "image/jpeg" });
      if (error) throw new Error(`Envoi échoué : ${error.message}`);
      setApercus((a) => ({ ...a, [kind]: URL.createObjectURL(fichier) }));
      onPhotos([...photos.filter((p) => p.kind !== kind), { kind, path: json.storagePath }]);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setEnvoi(null);
    }
  }

  const faites = new Set(photos.map((p) => p.kind));

  return (
    <div className="flex flex-col gap-2">
      <fieldset>
        <legend className="label">Type de changement *</legend>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["changement", "Changement de véhicule"],
              ["depannage", "Dépannage (panne, remorquage)"],
            ] as const
          ).map(([v, l]) => (
            <label key={v} className="flex min-h-[44px] items-center gap-2 rounded-lg bg-surface p-2 text-sm">
              <input type="radio" name="type-changement" checked={type === v} onChange={() => onType(v)} />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      {type === "changement" && (
        <div>
          <p className="label">Photos du véhicule récupéré * ({faites.size}/{PHOTOS_CHANGEMENT.length})</p>
          <p className="mb-2 text-xs text-navy/60">
            Obligatoires : elles datent l&apos;état du véhicule à la prise en main et permettent de savoir qui a fait les dégâts.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {PHOTOS_CHANGEMENT.map(({ kind, libelle }) => (
              <label
                key={kind}
                className={`relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-lg border text-center text-xs ${faites.has(kind) ? "border-teal" : "border-dashed border-navy/25"}`}
              >
                {apercus[kind] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={apercus[kind]} alt={libelle} className="absolute inset-0 h-full w-full object-cover" />
                ) : null}
                <span className={`relative z-10 rounded px-1 font-semibold ${apercus[kind] ? "bg-white/85 text-navy" : "text-navy/70"}`}>
                  {envoi === kind ? "Envoi…" : faites.has(kind) ? `✓ ${libelle}` : `📷 ${libelle}`}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={envoi !== null}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) prendre(kind, f);
                    e.target.value = "";
                  }}
                />
              </label>
            ))}
          </div>
        </div>
      )}
      {erreur && <p role="alert" className="text-xs text-orange-ink">{erreur}</p>}
    </div>
  );
}
