"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { IconCamera, IconCheck, IconQrCode, IconX } from "@/components/layout/icons";
import { LIEUX_LIVRAISON, normaliserCodeQr, photoObligatoire, qrObligatoire, resumeCodeQr, type LieuLivraison } from "@/lib/colis/livraison";
import { scannerNatif, scannerNatifDisponible } from "@/lib/colis/natif";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { api, imageEnBase64, type Stop } from "@/components/colis/commun";

// Scanner web (caméra + jsQR) chargé seulement pour une livraison avec QR code.
const ParcelScanner = dynamic(() => import("@/components/colis/ParcelScanner").then((m) => m.ParcelScanner), { ssr: false });

/**
 * Validation d'une livraison : où / comment le colis a été remis, et
 * preuve — photo du colis livré (facultative, sauf boîte aux lettres et
 * jardin où elle est obligatoire) ou, pour une livraison avec QR code,
 * QR code présenté par le destinataire scanné (ou code de retrait saisi).
 */
export function LivraisonSheet({ stop, onClose, onLivre }: { stop: Stop; onClose: () => void; onLivre: (s: Stop) => void }) {
  const [lieu, setLieu] = useState<LieuLivraison>("main_propre");
  const [precision, setPrecision] = useState("");
  const [photo, setPhoto] = useState<{ base64: string; apercu: string } | null>(null);
  const [codeQr, setCodeQr] = useState("");
  const [messageLaisse, setMessageLaisse] = useState(false);
  const [reserveOuverte, setReserveOuverte] = useState(false);
  const [reserve, setReserve] = useState("");
  const [scanWeb, setScanWeb] = useState(false);
  const [busy, setBusy] = useState<"photo" | "envoi" | "scan" | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const obligatoire = photoObligatoire(lieu);
  const avecQr = qrObligatoire(lieu);
  const codeLu = normaliserCodeQr(codeQr);

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

  /** Application des stores : scanner natif Google ; sinon scanner web (caméra du navigateur). */
  async function scanner() {
    setErreur(null);
    if (!scannerNatifDisponible()) return setScanWeb(true);
    setBusy("scan");
    try {
      const lu = await scannerNatif();
      if (lu) lireCode(lu);
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  function lireCode(texte: string) {
    setScanWeb(false);
    const code = normaliserCodeQr(texte);
    if (!code) return setErreur("QR code illisible, rescannez-le.");
    setCodeQr(code);
    setErreur(null);
  }

  function choisirLieu(l: LieuLivraison) {
    setLieu(l);
    setErreur(null);
    // Livraison avec QR code : le scanner s'ouvre directement.
    if (qrObligatoire(l) && !codeLu) void scanner();
  }

  async function valider() {
    if (obligatoire && !photo) return setErreur("Prenez la photo du colis déposé.");
    if (avecQr && !codeLu) return setErreur("Scannez le QR code du destinataire (ou saisissez son code de retrait).");
    setBusy("envoi");
    setErreur(null);
    try {
      const { stop: maj } = await api<{ stop: Stop }>(`/api/colis/arrets/${stop.id}/livraison`, {
        method: "POST",
        body: JSON.stringify({ lieu, precision: precision.trim() || null, image: photo?.base64 ?? null, code_qr: avecQr ? codeLu : null, message_laisse: messageLaisse, reserve: reserve.trim() || null }),
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
      {scanWeb && <ParcelScanner calque="z-[90]" consigne="Scannez le QR code présenté par le destinataire" bouton="Annuler" onCode={lireCode} onClose={() => setScanWeb(false)} />}
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
          <legend className="mb-2 text-sm font-semibold">Comment avez-vous remis le colis ?</legend>
          <div className="grid grid-cols-2 gap-2">
            {LIEUX_LIVRAISON.map((l) => (
              <button
                key={l.key}
                type="button"
                aria-pressed={lieu === l.key}
                onClick={() => choisirLieu(l.key)}
                className={`rounded-xl border px-3 py-3 text-left text-sm transition-colors ${
                  lieu === l.key ? "border-teal bg-teal/10 font-semibold" : "border-navy/10 hover:border-navy/25"
                } ${l.key === "main_propre" || l.key === "qr_code" ? "col-span-2" : ""}`}
              >
                {l.qr ? (
                  <span className="flex items-center gap-2">
                    <IconQrCode className="h-4 w-4" /> {l.label}
                  </span>
                ) : (
                  l.label
                )}
                {l.photo && <span className="block text-xs font-normal text-orange-ink">Photo obligatoire</span>}
                {l.qr && <span className="block text-xs font-normal text-navy/60">Scannez le QR code du destinataire ou son code de retrait</span>}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-col gap-2 rounded-xl border border-navy/10 p-3">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={messageLaisse} onChange={(e) => setMessageLaisse(e.target.checked)} className="h-4 w-4 accent-teal" />
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-orange/10 text-sm font-extrabold text-orange-ink">M</span>
            <span className="flex-1">Message laissé / avis de passage</span>
          </label>
          <button type="button" className="btn-secondary justify-center !py-2.5 text-sm" onClick={() => setReserveOuverte((v) => !v)}>
            {reserveOuverte ? "Fermer les réserves" : "＋ Ajouter une réserve"}
          </button>
          {reserveOuverte && (
            <textarea className="input min-h-20 resize-y" value={reserve} onChange={(e) => setReserve(e.target.value)} maxLength={500} placeholder="Précisez le problème ou la réserve constatée…" aria-label="Réserve de livraison" />
          )}
          <p className="text-xs text-navy/55">Le M et la réserve seront enregistrés dans la trace de livraison.</p>
        </div>

        {(lieu === "voisin" || lieu === "autre") && (
          <input
            className="input"
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
            placeholder={lieu === "voisin" ? "Nom ou numéro du voisin" : "Lieu de dépôt (garage, local vélo…)"}
            aria-label="Précision sur le lieu de dépôt"
          />
        )}

        {avecQr && (
          <div className="flex flex-col gap-2 rounded-xl border border-teal/40 p-3">
            {codeLu ? (
              <p className="flex items-center gap-2 text-sm">
                <IconCheck className="h-4 w-4 shrink-0 text-teal-ink" />
                <span className="min-w-0">
                  QR code lu : <span className="break-all font-mono font-semibold">{resumeCodeQr(codeLu, 40)}</span>
                </span>
              </p>
            ) : (
              <p className="text-sm text-navy/70">Demandez au destinataire son QR code de livraison (SMS, e-mail ou application du transporteur).</p>
            )}
            <button type="button" className={`justify-center !py-3 ${codeLu ? "btn-secondary" : "btn-primary"}`} disabled={busy !== null} onClick={scanner}>
              <IconQrCode className="h-5 w-5" /> {busy === "scan" ? "Scanner ouvert…" : codeLu ? "Rescanner" : "Scanner le QR code"}
            </button>
            <input
              className="input font-mono text-sm"
              value={codeQr}
              onChange={(e) => setCodeQr(e.target.value)}
              placeholder="Ou saisissez le code de retrait"
              aria-label="Code lu ou code de retrait du destinataire"
              autoComplete="off"
              maxLength={500}
            />
          </div>
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

        <button type="button" className="btn-primary justify-center !py-3.5 text-base" disabled={busy !== null || (obligatoire && !photo) || (avecQr && !codeLu)} onClick={valider}>
          <IconCheck className="h-5 w-5" /> {busy === "envoi" ? "Envoi…" : "Valider la livraison"}
        </button>
      </div>
    </div>
  );
}
