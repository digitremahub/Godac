"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconCamera, IconFileText } from "@/components/layout/icons";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { resumeCodeQr } from "@/lib/colis/livraison";
import { BadgeConfiance, Commentaires, type CommentaireVue } from "@/components/rattachement/Commentaires";
import type { PreuveLivraison } from "@/lib/rattachement/contestation";
import { dateParis, heureParis } from "@/lib/rattachement/format";

export interface CandidatArret {
  stopId: string;
  driverId: string;
  driverName: string;
  runId: string;
  confiance: string;
  raison: string;
  parcelCode: string | null;
  address: string;
  doneAt: string | null;
}

export interface Contestation {
  id: string;
  status: "to_validate" | "assigned" | "answered" | "resolved" | "rejected";
  /** Livraison retrouvée dans une tournée colis (lieu de dépôt, photo). */
  preuve: { stopId: string; photo: boolean; lieu: string | null; relais?: string | null; code?: string | null; livreLe: string | null } | null;
  client_name: string | null;
  reference: string | null;
  parcel_code: string | null;
  delivery_address: string | null;
  delivery_date: string | null;
  tour_number: string | null;
  reason: string | null;
  claimed_amount: number | null;
  suggested_driver_id: string | null;
  suggestion_reason: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_response: string | null;
  responded_at: string | null;
  resolution_note: string | null;
  created_at: string;
  /** Nombre de documents de la réclamation (photos, captures, PDF). */
  documents: number;
  recipient: string | null;
  delivery_stop_id: string | null;
  confiance: string | null;
  raison: string | null;
  candidats: CandidatArret[];
  /** Preuves détaillées (photos, lieu, code, GPS, historique), calculées au rapprochement. */
  preuveDetaillee: PreuveLivraison | null;
  commentaires: CommentaireVue[];
}

/** Lien vers la photo prise par le chauffeur à la livraison, avec le lieu de dépôt. */
function PreuveLivraison({ c }: { c: Contestation }) {
  if (!c.preuve) return null;
  const quand = c.preuve.livreLe ? new Date(c.preuve.livreLe).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const texte = ["Livré", c.preuve.lieu?.toLowerCase(), quand && `le ${quand}`].filter(Boolean).join(" ");
  // Remise au point relais (ou dépôt sur un arrêt point relais) : relais, puis photo et / ou code du relais.
  if (c.preuve.relais) {
    return (
      <span className="flex flex-wrap items-center gap-2 self-center text-xs text-navy/60">
        <span className="text-relais-ink">
          {c.preuve.relais}
          {quand ? ` · le ${quand}` : ""}
        </span>
        {c.preuve.photo && (
          <a href={`/api/colis/arrets/${c.preuve.stopId}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !py-1 text-xs text-teal-ink">
            📷 Photo du dépôt
          </a>
        )}
      </span>
    );
  }
  // Livraison avec QR code : la valeur scannée chez le destinataire fait preuve.
  if (c.preuve.code) {
    return (
      <span className="self-center text-xs text-navy/60" title={c.preuve.code}>
        {texte} · QR code scanné : <span className="font-mono text-navy/80">{resumeCodeQr(c.preuve.code, 40)}</span>
      </span>
    );
  }
  return c.preuve.photo ? (
    <a href={`/api/colis/arrets/${c.preuve.stopId}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !py-2 text-sm text-teal-ink">
      📷 Photo de livraison{c.preuve.lieu || quand ? ` · ${texte}` : ""}
    </a>
  ) : c.preuve.lieu ? (
    <span className="self-center text-xs text-navy/60">{texte} · sans photo</span>
  ) : null;
}

/** Liens vers les documents de la réclamation. */
function Documents({ c }: { c: Contestation }) {
  if (c.documents === 0) return <span className="self-center text-xs text-orange-ink">Réclamation non jointe</span>;
  return (
    <>
      {Array.from({ length: c.documents }, (_, i) => (
        <a key={i} href={`/api/contestations/${c.id}/document?i=${i}`} target="_blank" rel="noreferrer" className="btn-ghost !py-2 text-sm">
          <IconFileText className="h-4 w-4" /> Réclamation{c.documents > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
    </>
  );
}

/** Preuves de livraison détaillées : photos, lieu, code, clôture, position GPS, historique de l'arrêt. */
function PreuveDetaillee({ p }: { p: PreuveLivraison }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border p-3 text-sm ${p.complete ? "border-teal/40 bg-teal/[0.06]" : "border-orange/30 bg-orange/[0.05]"}`}>
      <p className={`font-semibold ${p.complete ? "text-teal-ink" : "text-orange-ink"}`}>{p.verdict}</p>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        <div className="flex gap-2"><dt className="text-navy/55">Clôture</dt><dd>{p.clotureA ? `${dateParis(p.clotureA)} à ${heureParis(p.clotureA)}` : "—"}</dd></div>
        <div className="flex gap-2"><dt className="text-navy/55">Lieu de dépôt</dt><dd>{p.lieu ?? "—"}{p.relais ? ` · ${p.relais}` : ""}</dd></div>
        {p.code && <div className="flex gap-2 sm:col-span-2"><dt className="text-navy/55">Code scanné</dt><dd className="font-mono" title={p.code}>{resumeCodeQr(p.code, 40)}</dd></div>}
        {p.gps && (
          <div className="flex gap-2 sm:col-span-2">
            <dt className="text-navy/55">Position GPS</dt>
            <dd>
              <a className="text-teal-ink underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${p.gps.lat}&mlon=${p.gps.lng}#map=18/${p.gps.lat}/${p.gps.lng}`}>
                à {heureParis(p.gps.at)}
              </a>
              {p.gps.distanceM !== null ? ` · ${p.gps.distanceM} m de l'adresse` : ""}
            </dd>
          </div>
        )}
      </dl>
      {p.photos > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: p.photos }, (_, i) => (
            <a key={i} href={`/api/colis/arrets/${p.stopId}/livraison?index=${i}`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs text-teal-ink">
              📷 Photo de preuve {p.photos > 1 ? i + 1 : ""}
            </a>
          ))}
        </div>
      )}
      {p.historique.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-navy/60">Historique de l&apos;arrêt ({p.historique.length})</summary>
          <ul className="mt-1 text-xs text-navy/70">
            {p.historique.map((e, i) => (
              <li key={i}>
                {dateParis(e.at)} {heureParis(e.at)} — {e.libelle}
                {e.details ? ` : ${e.details}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const STATUT: Record<Contestation["status"], { label: string; cls: string }> = {
  to_validate: { label: "À valider", cls: "bg-gold/25 text-navy" },
  assigned: { label: "Responsable notifié", cls: "bg-orange/15 text-orange-ink" },
  answered: { label: "Réponse reçue", cls: "bg-teal/15 text-teal-ink" },
  resolved: { label: "Réglée", cls: "bg-navy/[0.06] text-navy/70" },
  rejected: { label: "Contestée / sans suite", cls: "bg-navy/[0.06] text-navy/70" },
};

const CHAMPS: { key: keyof Contestation; label: string; type?: string }[] = [
  { key: "client_name", label: "Client" },
  { key: "reference", label: "N° de réclamation" },
  { key: "parcel_code", label: "N° de colis" },
  { key: "delivery_date", label: "Date de livraison", type: "date" },
  { key: "tour_number", label: "N° de tournée" },
  { key: "claimed_amount", label: "Montant réclamé (€)", type: "number" },
  { key: "recipient", label: "Destinataire" },
  { key: "delivery_address", label: "Adresse de livraison" },
];

const dateFr = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("fr-FR") : "—");

async function patch(id: string, body: unknown) {
  const res = await fetch(`/api/contestations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Action impossible");
  return json;
}

function Details({ c }: { c: Contestation }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      {[
        ["Client", c.client_name],
        ["Réclamation", c.reference],
        ["Colis", c.parcel_code],
        ["Livraison", c.delivery_date ? dateFr(c.delivery_date) : null],
        ["Tournée", c.tour_number],
        ["Montant réclamé", c.claimed_amount !== null ? `${c.claimed_amount.toLocaleString("fr-FR")} €` : null],
        ["Destinataire", c.recipient],
        ["Adresse", c.delivery_address],
      ]
        .filter(([, v]) => v)
        .map(([l, v]) => (
          <div key={l as string} className="flex gap-2">
            <dt className="shrink-0 text-navy/55">{l}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function CarteEncadrement({ c, chauffeurs, moi, focus }: { c: Contestation; chauffeurs: { id: string; name: string }[]; moi: string; focus: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(() => Object.fromEntries(CHAMPS.map(({ key }) => [key, c[key] === null ? "" : String(c[key])])) as Record<string, string>);
  const [reason, setReason] = useState(c.reason ?? "");
  const [driver, setDriver] = useState(c.driver_id ?? c.suggested_driver_id ?? "");
  const [stop, setStop] = useState<string | null>(c.delivery_stop_id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const champs = () => ({
    ...Object.fromEntries(CHAMPS.map(({ key, type }) => [key, f[key] === "" ? null : type === "number" ? Number(f[key]) : f[key]])),
    reason: reason.trim() || null,
  });

  async function run(body: unknown) {
    setBusy(true);
    setError(null);
    try {
      await patch(c.id, body);
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const s = STATUT[c.status];
  return (
    <div id={`contestation-${c.id}`}>
    <Card className={`flex flex-col gap-3 ${focus ? "ring-2 ring-teal" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg font-bold">{c.client_name ?? "Client non renseigné"}</p>
          <p className="text-xs text-navy/55">Reçue le {dateFr(c.created_at)}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{s.label}</span>
      </div>

      {c.status === "to_validate" ? (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {CHAMPS.map(({ key, label, type }) => (
              <label key={key} className={`block ${key === "delivery_address" ? "sm:col-span-2" : ""}`}>
                <span className="label">{label}</span>
                <input className="input !py-1.5" type={type ?? "text"} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
              </label>
            ))}
            <label className="block sm:col-span-2">
              <span className="label">Motif</span>
              <textarea className="input min-h-[60px] !py-1.5" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          <div className="rounded-xl bg-navy/[0.04] p-3">
            <label className="block">
              <span className="label">Chauffeur concerné</span>
              <select className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="">— Choisir —</option>
                {chauffeurs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {d.id === c.suggested_driver_id ? " (suggéré)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <BadgeConfiance confiance={c.confiance} />
              <span className="text-xs text-navy/60">
                {c.suggestion_reason ? `Suggestion : ${c.suggestion_reason}.` : c.raison ?? "Aucune suggestion : complétez n° de colis, adresse, date ou tournée puis relancez la recherche."}
              </span>
            </div>
            {c.candidats.length > 1 && (
              <fieldset className="mt-2 flex flex-col gap-1 text-xs">
                <legend className="mb-1 text-navy/60">Livraisons possibles :</legend>
                {c.candidats.map((k) => (
                  <label key={k.stopId} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={`arret-${c.id}`}
                      checked={stop === k.stopId}
                      onChange={() => {
                        setStop(k.stopId);
                        setDriver(k.driverId);
                      }}
                    />
                    <span>
                      {k.driverName} — {k.confiance} : {k.raison}
                      {k.doneAt ? ` (livré le ${dateParis(k.doneAt)} à ${heureParis(k.doneAt)})` : ""} · {k.address}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
          {c.preuveDetaillee ? <PreuveDetaillee p={c.preuveDetaillee} /> : null}
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !driver}
              onClick={() => run({ action: "valider", driver_id: driver, stop_id: c.candidats.find((k) => k.stopId === stop)?.driverId === driver ? stop : null, champs: champs() })}
            >
              Valider le responsable et notifier
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={async () => {
                await run({ action: "enregistrer", champs: champs() });
                await run({ action: "resuggerer" });
              }}
            >
              Enregistrer et relancer la recherche
            </button>
            <Documents c={c} />
            {!c.preuveDetaillee && <PreuveLivraison c={c} />}
          </div>
        </>
      ) : (
        <>
          <Details c={c} />
          {c.reason && <p className="rounded-lg bg-navy/[0.04] px-3 py-2 text-sm">{c.reason}</p>}
          <p className="text-sm">
            Responsable : <strong>{c.driver_name ?? "—"}</strong>
          </p>
          {c.preuveDetaillee && <PreuveDetaillee p={c.preuveDetaillee} />}
          {c.driver_response && (
            <div className="rounded-xl border border-teal/30 bg-teal/[0.06] p-3 text-sm">
              <p className="text-xs font-semibold text-teal-ink">Réponse du chauffeur · {dateFr(c.responded_at)}</p>
              <p className="mt-1 whitespace-pre-line">{c.driver_response}</p>
            </div>
          )}
          {c.resolution_note && <p className="text-sm text-navy/70">Clôture : {c.resolution_note}</p>}
          {(c.status === "assigned" || c.status === "answered") && (
            <div className="flex flex-col gap-2">
              <input className="input !py-1.5" placeholder="Note de clôture (geste commercial, remboursement…)" value={note} onChange={(e) => setNote(e.target.value)} />
              {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={() => run({ action: "cloturer", statut: "resolved", note: note.trim() || null })}>
                  Marquer réglée
                </button>
                <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => run({ action: "cloturer", statut: "rejected", note: note.trim() || null })}>
                  Classer sans suite
                </button>
                <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => run({ action: "cloturer", statut: "rejected", note: note.trim() || "Contestée : preuve de livraison opposée au client" })}>
                  Contester (preuve)
                </button>
                <Documents c={c} />
                {!c.preuveDetaillee && <PreuveLivraison c={c} />}
              </div>
            </div>
          )}
          {(c.status === "resolved" || c.status === "rejected") && (
            <div className="flex flex-wrap gap-2">
              <Documents c={c} />
            </div>
          )}
          {c.driver_id && (
            <details open={focus && c.commentaires.length > 0} className="rounded-xl border border-navy/10 p-3">
              <summary className="cursor-pointer text-sm font-semibold">Échanges avec le chauffeur ({c.commentaires.length})</summary>
              <div className="mt-2">
                <Commentaires api={`/api/contestations/${c.id}`} routePiece="document" commentaires={c.commentaires} moi={moi} placeholder="Message au chauffeur…" ouvert={c.status === "assigned" || c.status === "answered"} />
              </div>
            </details>
          )}
        </>
      )}
    </Card>
    </div>
  );
}

function CarteChauffeur({ c, moi, focus }: { c: Contestation; moi: string; focus: boolean }) {
  const router = useRouter();
  const [reponse, setReponse] = useState(c.driver_response ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const s = STATUT[c.status];
  const ouverte = c.status === "assigned" || c.status === "answered";
  return (
    <div id={`contestation-${c.id}`}>
    <Card className={`flex flex-col gap-3 ${focus ? "ring-2 ring-teal" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-display text-lg font-bold">{c.client_name ?? "Contestation client"}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{c.status === "assigned" ? "À régler" : s.label}</span>
      </div>
      <Details c={c} />
      {c.reason && <p className="rounded-lg bg-orange/[0.07] px-3 py-2 text-sm">{c.reason}</p>}
      <div className="flex flex-wrap gap-2">
        <Documents c={c} />
        {!c.preuveDetaillee && <PreuveLivraison c={c} />}
      </div>
      {c.preuveDetaillee && <PreuveDetaillee p={c.preuveDetaillee} />}
      {c.resolution_note && <p className="text-sm text-navy/70">Clôture : {c.resolution_note}</p>}
      {ouverte && (
        <>
          <label className="block">
            <span className="label">Votre explication</span>
            <textarea
              className="input min-h-[90px]"
              value={reponse}
              onChange={(e) => setReponse(e.target.value)}
              placeholder="Ce qui s'est passé, où le colis a été déposé, à qui il a été remis…"
            />
          </label>
          {message && <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>{message.text}</p>}
          <button
            type="button"
            className="btn-primary w-fit"
            disabled={busy || reponse.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              try {
                await patch(c.id, { action: "repondre", reponse });
                setMessage({ ok: true, text: "Réponse envoyée à votre responsable." });
                router.refresh();
              } catch (e) {
                setMessage({ ok: false, text: networkErrorMessage(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            {c.driver_response ? "Mettre à jour ma réponse" : "Envoyer ma réponse"}
          </button>
        </>
      )}
      {(ouverte || c.commentaires.length > 0) && (
        <div className="border-t border-navy/10 pt-3">
          <p className="mb-2 text-sm font-semibold">Photos et compléments</p>
          <Commentaires api={`/api/contestations/${c.id}`} routePiece="document" commentaires={c.commentaires} moi={moi} placeholder="Un complément, une photo du lieu de dépôt…" libelleEnvoi="Envoyer à mon responsable" ouvert={ouverte} />
        </div>
      )}
    </Card>
    </div>
  );
}

function NouvelleContestation({ organizationId, lectureAuto }: { organizationId: string; lectureAuto: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  /** La réclamation est obligatoire : un ou plusieurs fichiers (photo, capture du mail / du ticket, courrier, PDF). */
  async function creer(files: File[]) {
    if (files.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const document_paths: string[] = [];
      for (const file of files.slice(0, 6)) {
        const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await createBrowserSupabaseClient().storage.from("dispute-docs").upload(path, file, { contentType: file.type });
        if (error) throw new Error(`Envoi du document impossible : ${error.message}`);
        document_paths.push(path);
      }
      const res = await fetch("/api/contestations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_paths }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Création impossible");
      const suggestion = json.suggestion ? `Responsable suggéré (${json.confiance}) : ${json.suggestion.driverName}.` : "Aucun chauffeur trouvé automatiquement : complétez puis relancez la recherche.";
      setMessage({
        ok: json.lecture !== "echec",
        text:
          json.lecture === "ok"
            ? `Réclamation lue. ${suggestion} Vérifiez puis validez.`
            : json.lecture === "echec"
              ? json.lectureErreur
                ? `${json.lectureErreur} Complétez les champs à la main.`
                : "Document illisible : complétez les champs à la main."
              : "Contestation créée : complétez les champs.",
      });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg">Nouvelle contestation</h2>
      <p className="text-sm text-navy/65">
        {lectureAuto
          ? "Joignez la réclamation (photo, capture du mail ou du ticket transporteur, courrier, PDF — plusieurs fichiers possibles) : GODAC la lit, retrouve la livraison et propose le chauffeur concerné ; vous validez avant toute notification."
          : "Joignez la réclamation (photo, capture, courrier, PDF — plusieurs fichiers possibles) : la lecture automatique est désactivée, vous complétez les champs."}
      </p>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={(e) => creer(Array.from(e.target.files ?? []))} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconCamera className="h-4 w-4" /> {busy ? "Lecture…" : "Photo(s) ou document(s) de la réclamation"}
        </button>
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>{message.text}</p>}
    </Card>
  );
}

const ONGLETS = [
  { key: "a_valider", label: "À traiter", statuts: ["to_validate"] },
  { key: "en_cours", label: "Responsable désigné", statuts: ["assigned", "answered"] },
  { key: "closes", label: "Clôturées", statuts: ["resolved", "rejected"] },
] as const;

export function Contestations({
  contestations,
  encadrement,
  chauffeurs,
  organizationId,
  lectureAuto,
  moi = "",
  focusId = null,
}: {
  contestations: Contestation[];
  encadrement: boolean;
  chauffeurs: { id: string; name: string }[];
  organizationId: string;
  lectureAuto: boolean;
  moi?: string;
  focusId?: string | null;
}) {
  const ongletFocus = focusId ? ONGLETS.find((o) => (o.statuts as readonly string[]).includes(contestations.find((c) => c.id === focusId)?.status ?? ""))?.key : undefined;
  const [onglet, setOnglet] = useState<(typeof ONGLETS)[number]["key"]>(ongletFocus ?? (encadrement ? "a_valider" : "en_cours"));
  useEffect(() => {
    if (focusId) document.getElementById(`contestation-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);

  if (!encadrement) {
    const ouvertes = contestations.filter((c) => c.status === "assigned" || c.status === "answered");
    const closes = contestations.filter((c) => c.status === "resolved" || c.status === "rejected");
    return (
      <div className="flex flex-col gap-4">
        {ouvertes.length === 0 && <p className="text-sm text-navy/60">Aucune contestation en cours. 👍</p>}
        {ouvertes.map((c) => (
          <CarteChauffeur key={c.id} c={c} moi={moi} focus={c.id === focusId} />
        ))}
        {closes.length > 0 && <h2 className="mt-2 text-lg">Clôturées</h2>}
        {closes.map((c) => (
          <CarteChauffeur key={c.id} c={c} moi={moi} focus={c.id === focusId} />
        ))}
      </div>
    );
  }

  const tab = ONGLETS.find((o) => o.key === onglet)!;
  const visibles = contestations.filter((c) => (tab.statuts as readonly string[]).includes(c.status));
  return (
    <div className="flex flex-col gap-4">
      <NouvelleContestation organizationId={organizationId} lectureAuto={lectureAuto} />
      <div role="tablist" className="flex flex-wrap gap-2">
        {ONGLETS.map((o) => {
          const n = contestations.filter((c) => (o.statuts as readonly string[]).includes(c.status)).length;
          return (
            <button
              key={o.key}
              type="button"
              role="tab"
              aria-selected={onglet === o.key}
              className={onglet === o.key ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-secondary !px-3 !py-1.5 text-sm"}
              onClick={() => setOnglet(o.key)}
            >
              {o.label} ({n})
            </button>
          );
        })}
      </div>
      {visibles.length === 0 ? (
        <p className="text-sm text-navy/60">Rien ici.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visibles.map((c) => (
            <CarteEncadrement key={`${c.id}-${c.status}-${c.suggested_driver_id}-${c.delivery_stop_id}`} c={c} chauffeurs={chauffeurs} moi={moi} focus={c.id === focusId} />
          ))}
        </div>
      )}
    </div>
  );
}
