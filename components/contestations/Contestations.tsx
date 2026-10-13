"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { IconCamera, IconFileText } from "@/components/layout/icons";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { networkErrorMessage } from "@/lib/utils/network-error";

export interface Contestation {
  id: string;
  status: "to_validate" | "assigned" | "answered" | "resolved" | "rejected";
  has_document: boolean;
  /** Livraison retrouvée dans une tournée colis (lieu de dépôt, photo). */
  preuve: { stopId: string; photo: boolean; lieu: string | null; livreLe: string | null } | null;
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
}

/** Lien vers la photo prise par le chauffeur à la livraison, avec le lieu de dépôt. */
function PreuveLivraison({ c }: { c: Contestation }) {
  if (!c.preuve) return null;
  const quand = c.preuve.livreLe ? new Date(c.preuve.livreLe).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const texte = ["Livré", c.preuve.lieu?.toLowerCase(), quand && `le ${quand}`].filter(Boolean).join(" ");
  return c.preuve.photo ? (
    <a href={`/api/colis/arrets/${c.preuve.stopId}/livraison`} target="_blank" rel="noreferrer" className="btn-ghost !py-2 text-sm text-teal-ink">
      📷 Photo de livraison{c.preuve.lieu || quand ? ` · ${texte}` : ""}
    </a>
  ) : c.preuve.lieu ? (
    <span className="self-center text-xs text-navy/60">{texte} · sans photo</span>
  ) : null;
}

const STATUT: Record<Contestation["status"], { label: string; cls: string }> = {
  to_validate: { label: "À valider", cls: "bg-gold/25 text-navy" },
  assigned: { label: "Chauffeur notifié", cls: "bg-orange/15 text-orange-ink" },
  answered: { label: "Réponse reçue", cls: "bg-teal/15 text-teal-ink" },
  resolved: { label: "Réglée", cls: "bg-navy/[0.06] text-navy/70" },
  rejected: { label: "Sans suite", cls: "bg-navy/[0.06] text-navy/70" },
};

const CHAMPS: { key: keyof Contestation; label: string; type?: string }[] = [
  { key: "client_name", label: "Client" },
  { key: "reference", label: "N° de réclamation" },
  { key: "parcel_code", label: "N° de colis" },
  { key: "delivery_date", label: "Date de livraison", type: "date" },
  { key: "tour_number", label: "N° de tournée" },
  { key: "claimed_amount", label: "Montant réclamé (€)", type: "number" },
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

function CarteEncadrement({ c, chauffeurs }: { c: Contestation; chauffeurs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState(() => Object.fromEntries(CHAMPS.map(({ key }) => [key, c[key] === null ? "" : String(c[key])])) as Record<string, string>);
  const [reason, setReason] = useState(c.reason ?? "");
  const [driver, setDriver] = useState(c.driver_id ?? c.suggested_driver_id ?? "");
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
    <Card className="flex flex-col gap-3">
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
            <p className="mt-1.5 text-xs text-navy/60">
              {c.suggestion_reason ? `Suggestion : ${c.suggestion_reason}.` : "Aucune suggestion : complétez n° de colis, date ou tournée puis « Rechercher »."}
            </p>
          </div>
          {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy || !driver} onClick={() => run({ action: "valider", driver_id: driver, champs: champs() })}>
              Valider et notifier le chauffeur
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
              Enregistrer et rechercher le chauffeur
            </button>
            {c.has_document && (
              <a href={`/api/contestations/${c.id}/document`} target="_blank" rel="noreferrer" className="btn-ghost">
                <IconFileText className="h-4 w-4" /> Document
              </a>
            )}
            <PreuveLivraison c={c} />
          </div>
        </>
      ) : (
        <>
          <Details c={c} />
          {c.reason && <p className="rounded-lg bg-navy/[0.04] px-3 py-2 text-sm">{c.reason}</p>}
          <p className="text-sm">
            Chauffeur : <strong>{c.driver_name ?? "—"}</strong>
          </p>
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
                {c.has_document && (
                  <a href={`/api/contestations/${c.id}/document`} target="_blank" rel="noreferrer" className="btn-ghost !py-2 text-sm">
                    <IconFileText className="h-4 w-4" /> Document
                  </a>
                )}
                <PreuveLivraison c={c} />
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function CarteChauffeur({ c }: { c: Contestation }) {
  const router = useRouter();
  const [reponse, setReponse] = useState(c.driver_response ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const s = STATUT[c.status];
  const ouverte = c.status === "assigned" || c.status === "answered";
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-display text-lg font-bold">{c.client_name ?? "Contestation client"}</p>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`}>{c.status === "assigned" ? "À régler" : s.label}</span>
      </div>
      <Details c={c} />
      {c.reason && <p className="rounded-lg bg-orange/[0.07] px-3 py-2 text-sm">{c.reason}</p>}
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
    </Card>
  );
}

function NouvelleContestation({ organizationId, lectureAuto }: { organizationId: string; lectureAuto: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function creer(file: File | null) {
    setBusy(true);
    setMessage(null);
    try {
      let document_path: string | null = null;
      if (file) {
        const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        document_path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await createBrowserSupabaseClient().storage.from("dispute-docs").upload(document_path, file, { contentType: file.type });
        if (error) throw new Error(`Envoi du document impossible : ${error.message}`);
      }
      const res = await fetch("/api/contestations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ document_path }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Création impossible");
      setMessage({
        ok: json.lecture !== "echec",
        text:
          json.lecture === "ok"
            ? `Document lu. ${json.suggestion ? `Chauffeur suggéré : ${json.suggestion.driverName}.` : "Aucun chauffeur trouvé automatiquement."} Vérifiez puis validez.`
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
          ? "Photographiez ou importez la réclamation (photo, capture, PDF) : GODAC la lit, propose le chauffeur concerné, et vous validez avant toute notification."
          : "La lecture automatique est désactivée pour votre entreprise : le document est joint et vous complétez les champs."}
      </p>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && creer(e.target.files[0])} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <IconCamera className="h-4 w-4" /> {busy ? "Lecture…" : "Photo ou document"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => creer(null)}>
          Saisie manuelle
        </button>
      </div>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-teal-ink" : "text-orange-ink"}`}>{message.text}</p>}
    </Card>
  );
}

const ONGLETS = [
  { key: "a_valider", label: "À valider", statuts: ["to_validate"] },
  { key: "en_cours", label: "En cours", statuts: ["assigned", "answered"] },
  { key: "closes", label: "Clôturées", statuts: ["resolved", "rejected"] },
] as const;

export function Contestations({
  contestations,
  encadrement,
  chauffeurs,
  organizationId,
  lectureAuto,
}: {
  contestations: Contestation[];
  encadrement: boolean;
  chauffeurs: { id: string; name: string }[];
  organizationId: string;
  lectureAuto: boolean;
}) {
  const [onglet, setOnglet] = useState<(typeof ONGLETS)[number]["key"]>(encadrement ? "a_valider" : "en_cours");

  if (!encadrement) {
    const ouvertes = contestations.filter((c) => c.status === "assigned" || c.status === "answered");
    const closes = contestations.filter((c) => c.status === "resolved" || c.status === "rejected");
    return (
      <div className="flex flex-col gap-4">
        {ouvertes.length === 0 && <p className="text-sm text-navy/60">Aucune contestation en cours. 👍</p>}
        {ouvertes.map((c) => (
          <CarteChauffeur key={c.id} c={c} />
        ))}
        {closes.length > 0 && <h2 className="mt-2 text-lg">Clôturées</h2>}
        {closes.map((c) => (
          <CarteChauffeur key={c.id} c={c} />
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
            <CarteEncadrement key={`${c.id}-${c.status}-${c.suggested_driver_id}`} c={c} chauffeurs={chauffeurs} />
          ))}
        </div>
      )}
    </div>
  );
}
