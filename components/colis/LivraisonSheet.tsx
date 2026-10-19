"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { IconCamera, IconCheck, IconPointRelais, IconQrCode, IconX } from "@/components/layout/icons";
import { LIEUX_LIVRAISON, estPointRelais, normaliserCodeQr, photoObligatoire, qrObligatoire, refusPreuve, relaisObligatoire, resumeCodeQr, type LieuLivraison } from "@/lib/colis/livraison";
import { RESEAUX_RELAIS, lireRetours, normaliserNomRelais } from "@/lib/colis/relais";
import { BadgePointRelais } from "@/components/colis/Ramasse";
import { scannerNatif, scannerNatifDisponible } from "@/lib/colis/natif";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { enqueueOfflineMutation, isNetworkFailure } from "@/lib/offline/outbox";
import { api, imageEnBase64, type Stop } from "@/components/colis/commun";

// Scanner web (caméra + jsQR) chargé seulement pour une livraison avec QR code.
const ParcelScanner = dynamic(() => import("@/components/colis/ParcelScanner").then((m) => m.ParcelScanner), { ssr: false });

/**
 * Validation d'une livraison : où / comment le colis a été remis, et
 * preuve — photo du colis livré (facultative, sauf boîte aux lettres et
 * jardin où elle est obligatoire) ou, pour une livraison avec QR code,
 * QR code présenté par le destinataire scanné (ou code de retrait saisi).
 *
 * Point relais : un arrêt « point relais » se valide ici par « Déposé au
 * relais » (photo ou code / bordereau du relais scanné, colis déposés,
 * retours repris) ; une livraison peut aussi être remise « Au point
 * relais » en cas d'absence (nom ou adresse du relais, photo ou code).
 */
export function LivraisonSheet({ stop, onClose, onLivre }: { stop: Stop; onClose: () => void; onLivre: (s: Stop) => void }) {
  const arretRelais = estPointRelais(stop);
  const [lieu, setLieu] = useState<LieuLivraison>(arretRelais ? "point_relais" : "main_propre");
  const [nomRelais, setNomRelais] = useState(stop.relay_name ?? "");
  const [deposes, setDeposes] = useState(String(stop.packages_delivered ?? stop.parcel_count ?? 0));
  const [avecRetours, setAvecRetours] = useState(false);
  const [retours, setRetours] = useState("1");
  const [precision, setPrecision] = useState("");
  const [photos, setPhotos] = useState<{ base64: string; apercu: string }[]>([]);
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
  const auRelais = relaisObligatoire(lieu);
  const avecCode = avecQr || auRelais;
  const codeLu = normaliserCodeQr(codeQr);
  const relaisSaisi = normaliserNomRelais(nomRelais);
  // L'arrêt point relais est le relais lui-même : son nom n'est pas exigé.
  const preuveManquante = refusPreuve({ lieu, photo: photos.length > 0, code: codeLu, relais: relaisSaisi ?? (arretRelais ? stop.address : null) });

  useEffect(() => () => { photos.forEach((photo) => URL.revokeObjectURL(photo.apercu)); }, []);

  async function prendre(files: FileList | File[]) {
    const selection = Array.from(files).slice(0, 3 - photos.length);
    if (!selection.length) return;
    setBusy("photo");
    setErreur(null);
    try {
      const nouvelles = await Promise.all(selection.map(async (file) => ({ base64: await imageEnBase64(file), apercu: URL.createObjectURL(file) })));
      setPhotos((actuelles) => [...actuelles, ...nouvelles].slice(0, 3));
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
    if (!code) return setErreur(auRelais ? "Code du relais illisible, rescannez-le." : "QR code illisible, rescannez-le.");
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
    if (preuveManquante) return setErreur(preuveManquante);
    if (arretRelais && avecRetours && lireRetours(retours) === null) return setErreur("Nombre de retours repris illisible.");
    setBusy("envoi");
    setErreur(null);
    const corpsRelais = auRelais
      ? {
          relais: relaisSaisi,
          ...(arretRelais ? { retours: avecRetours ? lireRetours(retours) : 0, deposes: lireRetours(deposes) } : {}),
        }
      : {};
    try {
      const { stop: maj } = await api<{ stop: Stop }>(`/api/colis/arrets/${stop.id}/livraison`, {
        method: "POST",
        body: JSON.stringify({ lieu, precision: precision.trim() || null, images: photos.map((photo) => photo.base64), image: photos[0]?.base64 ?? null, code_qr: avecCode ? codeLu : null, message_laisse: messageLaisse, reserve: reserve.trim() || null, ...corpsRelais }),
      });
      navigator.vibrate?.(40);
      onLivre(maj);
    } catch (e) {
      if (isNetworkFailure(e)) {
        try {
          await enqueueOfflineMutation(`/api/colis/arrets/${stop.id}/livraison`, {
            method: "POST",
            body: JSON.stringify({ lieu, precision: precision.trim() || null, images: photos.map((photo) => photo.base64), image: photos[0]?.base64 ?? null, code_qr: avecCode ? codeLu : null, message_laisse: messageLaisse, reserve: reserve.trim() || null, ...corpsRelais }),
          });
          onLivre({
            ...stop,
            status: "delivered",
            done_at: new Date().toISOString(),
            delivered_place: lieu,
            proof_code: avecCode ? codeLu : null,
            ...(auRelais ? { relay_name: relaisSaisi ?? stop.relay_name ?? null } : {}),
          });
          return;
        } catch (queueError) {
          setErreur(networkErrorMessage(queueError));
        }
      } else {
        setErreur(networkErrorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="livraison-titre">
      {scanWeb && <ParcelScanner calque="z-[90]" consigne={auRelais ? "Scannez le code ou le bordereau du relais" : "Scannez le QR code présenté par le destinataire"} bouton="Annuler" onCode={lireCode} onClose={() => setScanWeb(false)} />}
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {arretRelais && <BadgePointRelais nom={stop.relay_name} className="mb-1" />}
            <h2 id="livraison-titre" className="font-display text-lg font-bold">
              {arretRelais ? "Déposé au relais" : "Colis livré"}
            </h2>
            <p className="truncate text-sm text-navy/65">{stop.address}</p>
          </div>
          <button type="button" className="btn-ghost !px-2 !py-1" onClick={onClose} aria-label="Annuler">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {!arretRelais && (
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
                } ${l.key === "main_propre" || l.key === "qr_code" || l.key === "point_relais" ? "col-span-2" : ""}`}
              >
                {l.qr || l.relais ? (
                  <span className="flex items-center gap-2">
                    {l.relais ? <IconPointRelais className="h-4 w-4 text-relais-ink" /> : <IconQrCode className="h-4 w-4" />} {l.label}
                  </span>
                ) : (
                  l.label
                )}
                {l.relais && <span className="block text-xs font-normal text-navy/60">Client absent : nom du relais, puis photo ou code du relais</span>}
                {l.photo && <span className="block text-xs font-normal text-orange-ink">Photo obligatoire</span>}
                {l.qr && <span className="block text-xs font-normal text-navy/60">Scannez le QR code du destinataire ou son code de retrait</span>}
              </button>
            ))}
          </div>
        </fieldset>
        )}

        {auRelais && (
          <div className="flex flex-col gap-2 rounded-xl border border-relais/50 p-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">{arretRelais ? "Nom du relais" : "Point relais (nom ou adresse)"}</span>
              <input
                className="input"
                value={nomRelais}
                onChange={(e) => setNomRelais(e.target.value)}
                list="reseaux-relais"
                maxLength={200}
                placeholder={arretRelais ? "ex. Relais Colis — Tabac de la Gare" : "ex. Pickup Tabac de la Gare, 2 place de la Mairie"}
                aria-label={arretRelais ? "Nom du relais" : "Nom ou adresse du point relais"}
                autoComplete="off"
              />
              <datalist id="reseaux-relais">
                {RESEAUX_RELAIS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            {arretRelais && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <span className="flex-1 text-navy/70">Colis déposés</span>
                  <input className="input !w-24 text-center" inputMode="numeric" value={deposes} onChange={(e) => setDeposes(e.target.value)} aria-label="Nombre de colis déposés au relais" />
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={avecRetours} onChange={(e) => setAvecRetours(e.target.checked)} className="h-4 w-4 accent-teal" />
                  <span className="flex-1">Retours repris</span>
                  {avecRetours && (
                    <input className="input !w-24 text-center" inputMode="numeric" value={retours} onChange={(e) => setRetours(e.target.value)} aria-label="Nombre de retours repris au relais" />
                  )}
                </label>
              </>
            )}
            <p className="text-xs text-navy/60">Preuve du dépôt : une photo ou le code / bordereau du relais scanné (l&apos;un des deux suffit).</p>
          </div>
        )}

        {!arretRelais && (
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
        )}

        {(lieu === "voisin" || lieu === "autre") && (
          <input
            className="input"
            value={precision}
            onChange={(e) => setPrecision(e.target.value)}
            placeholder={lieu === "voisin" ? "Nom ou numéro du voisin" : "Lieu de dépôt (garage, local vélo…)"}
            aria-label="Précision sur le lieu de dépôt"
          />
        )}

        {avecCode && (
          <div className={`flex flex-col gap-2 rounded-xl border p-3 ${auRelais ? "border-relais/50" : "border-teal/40"}`}>
            {codeLu ? (
              <p className="flex items-center gap-2 text-sm">
                <IconCheck className="h-4 w-4 shrink-0 text-teal-ink" />
                <span className="min-w-0">
                  {auRelais ? "Code du relais lu" : "QR code lu"} : <span className="break-all font-mono font-semibold">{resumeCodeQr(codeLu, 40)}</span>
                </span>
              </p>
            ) : auRelais ? (
              <p className="text-sm text-navy/70">Scannez le code du relais ou le bordereau de dépôt signé par le commerçant.</p>
            ) : (
              <p className="text-sm text-navy/70">Demandez au destinataire son QR code de livraison (SMS, e-mail ou application du transporteur).</p>
            )}
            <button type="button" className={`justify-center !py-3 ${codeLu || (auRelais && photos.length) ? "btn-secondary" : "btn-primary"}`} disabled={busy !== null} onClick={scanner}>
              <IconQrCode className="h-5 w-5" /> {busy === "scan" ? "Scanner ouvert…" : codeLu ? "Rescanner" : auRelais ? "Scanner le code du relais" : "Scanner le QR code"}
            </button>
            <input
              className="input font-mono text-sm"
              value={codeQr}
              onChange={(e) => setCodeQr(e.target.value)}
              placeholder={auRelais ? "Ou saisissez le code du relais / bordereau" : "Ou saisissez le code de retrait"}
              aria-label={auRelais ? "Code du relais ou du bordereau" : "Code lu ou code de retrait du destinataire"}
              autoComplete="off"
              maxLength={500}
            />
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => e.target.files?.length && prendre(e.target.files)} />
        <div className="flex flex-col gap-2 rounded-xl border border-navy/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Photos de preuve</p>
            <span className="text-xs text-navy/60">{photos.length}/3</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <div key={photo.apercu} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.apercu} alt={"Preuve de livraison " + (index + 1)} className="h-24 w-full rounded-lg object-cover" />
                <button type="button" className="absolute right-1 top-1 rounded-full bg-navy/80 px-2 py-1 text-xs text-white" aria-label={"Supprimer la photo " + (index + 1)} onClick={() => setPhotos((actuelles) => actuelles.filter((_, i) => i !== index))}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" className={"justify-center !py-3 " + (obligatoire && !photos.length ? "btn-primary" : "btn-secondary")} disabled={busy !== null || photos.length >= 3} onClick={() => fileRef.current?.click()}>
            <IconCamera className="h-5 w-5" /> {busy === "photo" ? "Préparation…" : photos.length >= 3 ? "3 photos ajoutées" : photos.length ? "Ajouter une photo" : obligatoire ? "Prendre une photo (obligatoire)" : "Ajouter une photo (facultatif)"}
          </button>
          <p className="text-xs text-navy/55">Jusqu’à 3 photos. {obligatoire ? "Au moins une photo est obligatoire pour ce lieu de dépôt." : auRelais ? "Photo ou code du relais : l’un des deux est obligatoire." : "Les photos sont facultatives."}</p>
        </div>

        {erreur && (
          <p role="alert" className="rounded-lg bg-orange/10 px-3 py-2 text-sm text-orange-ink">
            {erreur}
          </p>
        )}

        <button type="button" className="btn-primary justify-center !py-3.5 text-base" disabled={busy !== null || Boolean(preuveManquante)} onClick={valider}>
          <IconCheck className="h-5 w-5" /> {busy === "envoi" ? "Envoi…" : arretRelais ? "Valider le dépôt au relais" : auRelais ? "Valider la remise au relais" : "Valider la livraison"}
        </button>
      </div>
    </div>
  );
}
