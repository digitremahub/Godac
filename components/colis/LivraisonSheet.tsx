"use client";

import { useEffect, useRef, useState } from "react";
import { IconCamera, IconCheck, IconX } from "@/components/layout/icons";
import { LIEUX_LIVRAISON, photoObligatoire, type LieuLivraison } from "@/lib/colis/livraison";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { api, imageEnBase64, type Stop } from "@/components/colis/commun";

/**
 * Validation d'une livraison : où le colis a été déposé, et photo du
 * colis livré — facultative, sauf boîte aux lettres et jardin où elle
 * est obligatoire (preuve en cas de contestation du client).
 */
export function LivraisonSheet({ stop, onClose, onLivre }: { stop: Stop; onClose: () => void; onLivre: (s: Stop) => void }) {
  const [lieu, setLieu] = useState<LieuLivraison>("main_propre");
  const [precision, setPrecision] = useState("");
  const [photo, setPhoto] = useState<{ base64: string; apercu: string } | null>(null);
  const [busy, setBusy] = useState<"photo" | "envoi" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const obligatoire = photoObligatoire(lieu);

  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.apercu)), [photo]);

  async function prendre(file: File) {
    setBusy("photo");
    setErreur(null);
    try {
      setPhoto({ base64: await imageEnBase64(file), apercu: URL.createObjectURL(file) });
    } catch {
      setErreur("Photo illisible, reprenez-la.");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function valider() {
    if (obligatoire && !photo) return setErreur("Prenez la photo du colis déposé.");
    setBusy("envoi");
    setErreur(null);
    try {
      const { stop: maj } = await api<{ stop: Stop }>(`/api/colis/arrets/${stop.id}/livraison`, {
        method: "POST",
        body: JSON.stringify({ lieu, precision: precision.trim() || null, image: photo?.base64 ?? null }),
      });
      navigator.vibrate?.(40);
      onLivre(maj);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="livraison-titre">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="livraison-titre" className="font-display text-lg font-bold">
              Colis livré
            </h2>
            <p className="truncate text-sm text-navy/65">{stop.address}</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Annuler">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Où avez-vous déposé le colis ?</legend>
          <div className="grid grid-cols-2 gap-2">
            {LIEUX_LIVRAISON.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={lieu === l.key}
                onClick={() => (setLieu(l.key), setErreur(null))}
                className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors ${
                  lieu === l.key ? "border-teal bg-teal/10 font-semibold" : "border-navy/10 hover:border-navy/25"
                } ${l.key === "main_propre" ? "col-span-2" : ""}`}
              >
                {l.label}
                {l.photo && <span className="block text-xs font-normal text-orange-ink">Photo obligatoire</span>}
              </button>
            ))}
          </div>
        </fieldset>

        {(lieu === "voisin" || lieu === "autre") && (
          <input
            className="input"
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
            placeholder={lieu === "voisin" ? "Nom ou numéro du voisin" : "Lieu de dépôt (garage, local vélo…)"}
            aria-label="Précision sur le lieu de dépôt"
          />
        )}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && prendre(e.target.files[0])} />
        {photo ? (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.apercu} alt="Photo du colis livré" className="h-20 w-20 rounded-xl object-cover" />
            <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => fileRef.current?.click()}>
              <IconCamera className="h-4 w-4" /> Reprendre
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={`justify-center !py-3 ${obligatoire ? "btn-primary" : "btn-secondary"}`}
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            <IconCamera className="h-5 w-5" /> {busy === "photo" ? "Préparation…" : obligatoire ? "Prendre la photo (obligatoire)" : "Prendre une photo (facultatif)"}
          </button>
        )}

        {erreur && (
          <p role="alert" className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">
            {erreur}
          </p>
        )}

        <button type="button" className="btn-primary justify-center !py-3.5 text-base" disabled={busy !== null || (obligatoire && !photo)} onClick={valider}>
          <IconCheck className="h-5 w-5" /> {busy === "envoi" ? "Envoi…" : "Valider la livraison"}
        </button>
      </div>
    </div>
  );
}
