"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, EmptyState } from "@/components/ui";
import {
  canManagerAct,
  EVENT_LABELS,
  RENTAL_STATUS_BADGES,
  RENTAL_STATUS_LABELS,
  type ManagerAction,
  type RentalRequestStatus,
} from "@/lib/rental/workflow";

export interface RentalRequestItem {
  id: string;
  status: RentalRequestStatus;
  vehicleId: string;
  registration: string;
  providerName: string;
  providerHasEmail: boolean;
  type: string;
  description: string | null;
  urgency: string;
  createdAt: string;
  validatedBy: string | null;
  validatedAt: string | null;
  refusalReason: string | null;
  transmittedAt: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  completedAt: string | null;
  lastProviderComment: string | null;
  invoiceUrls: string[];
  tokenExpiresAt: string | null;
  events: { action: string; actorKind: string; actorName: string | null; comment: string | null; createdAt: string }[];
}

const URGENCY: Record<string, { label: string; badge: string }> = {
  low: { label: "Faible", badge: "badge-neutral" },
  normal: { label: "Normale", badge: "badge-teal" },
  high: { label: "Haute", badge: "badge-gold" },
  critical: { label: "Critique", badge: "badge-orange" },
};

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

const ACTION_BUTTONS: { action: ManagerAction; label: string; primary?: boolean }[] = [
  { action: "valider", label: "Valider et transmettre", primary: true },
  { action: "transmettre", label: "Renvoyer un lien" },
  { action: "terminer", label: "Clôturer" },
  { action: "refuser", label: "Refuser" },
];

export function RentalRequestsList({ requests, showVehicle = true }: { requests: RentalRequestItem[]; showVehicle?: boolean }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ id: string; text: string; link?: string; isError?: boolean } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function act(r: RentalRequestItem, action: ManagerAction) {
    let comment: string | null = null;
    if (action === "refuser") {
      comment = window.prompt("Motif du refus (facultatif) :", "");
      if (comment === null) return;
    }
    if (action === "transmettre" && !window.confirm("Un nouveau lien sera envoyé au prestataire ; l'ancien ne fonctionnera plus. Continuer ?")) return;
    if (action === "terminer" && !window.confirm("Clôturer la demande sans réponse du prestataire ?")) return;
    setBusyId(r.id);
    setMessage(null);
    try {
      const res = await fetch(`/api/rental-requests/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Action impossible.");
      if (json.transmitError) setMessage({ id: r.id, text: `Validée, mais non transmise : ${json.transmitError}`, isError: true });
      else if (json.providerLink && !json.emailSent)
        setMessage({ id: r.id, text: `Lien prestataire généré, e-mail non envoyé${json.reason ? ` (${json.reason})` : ""}. Copiez-le et transmettez-le vous-même :`, link: json.providerLink });
      else if (json.emailSent) setMessage({ id: r.id, text: "E-mail envoyé au prestataire avec son lien sécurisé." });
      router.refresh();
    } catch (e) {
      setMessage({ id: r.id, text: e instanceof Error ? e.message : "Erreur inattendue.", isError: true });
    } finally {
      setBusyId(null);
    }
  }

  if (requests.length === 0) {
    return <EmptyState title="Aucune demande au loueur" description="Les demandes d'entretien des véhicules loués apparaissent ici, à valider avant transmission au prestataire." />;
  }

  return (
    <div className="flex flex-col gap-3">
      {requests.map((r) => {
        const u = URGENCY[r.urgency] ?? { label: "Normale", badge: "badge-teal" };
        return (
          <Card key={r.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold">
                  {showVehicle && (
                    <>
                      <Link href={`/vehicles/${r.vehicleId}#location`} className="hover:underline">
                        {r.registration}
                      </Link>{" "}
                      ·{" "}
                    </>
                  )}
                  {r.type} <span className={`${u.badge} ml-1`}>{u.label}</span>{" "}
                  <span className={`${RENTAL_STATUS_BADGES[r.status]} ml-1`}>{RENTAL_STATUS_LABELS[r.status]}</span>
                </p>
                <p className="text-sm text-navy/70">
                  {r.providerName} · signalée le {fmt(r.createdAt)}
                  {r.validatedBy && r.validatedAt ? ` · validée par ${r.validatedBy} le ${fmt(r.validatedAt)}` : ""}
                  {r.transmittedAt ? ` · transmise le ${fmt(r.transmittedAt)}` : ""}
                </p>
                {r.description && <p className="mt-1 text-sm">{r.description}</p>}
                {r.slotStart && (
                  <p className="mt-1 text-sm">
                    Créneau : <strong>{fmt(r.slotStart)}</strong>
                    {r.slotEnd ? ` → ${fmt(r.slotEnd)}` : ""}
                  </p>
                )}
                {r.lastProviderComment && <p className="mt-1 text-sm text-navy/80">« {r.lastProviderComment} »</p>}
                {r.refusalReason && <p className="mt-1 text-sm text-orange-ink">Motif du refus : {r.refusalReason}</p>}
                {r.invoiceUrls.length > 0 && (
                  <p className="mt-1 text-sm">
                    {r.invoiceUrls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" className="mr-3 text-teal-ink hover:underline">
                        Document {i + 1}
                      </a>
                    ))}
                  </p>
                )}
                {!r.providerHasEmail && r.status !== "terminee" && r.status !== "refusee" && (
                  <p className="mt-1 text-xs text-orange-ink">Ce prestataire n&apos;a pas d&apos;adresse e-mail : le lien devra être transmis à la main.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ACTION_BUTTONS.filter((b) => canManagerAct(r.status, b.action)).map((b) => (
                  <button
                    key={b.action}
                    className={`${b.primary ? "btn-primary" : "btn-secondary"} !px-2 !py-1 text-xs`}
                    disabled={busyId === r.id}
                    onClick={() => act(r, b.action)}
                  >
                    {b.label}
                  </button>
                ))}
                <button className="btn-secondary !px-2 !py-1 text-xs" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                  Historique
                </button>
              </div>
            </div>
            {message?.id === r.id && (
              <div role={message.isError ? "alert" : "status"} className={`mt-2 text-sm ${message.isError ? "text-orange-ink" : "text-teal-ink"}`}>
                {message.text}
                {message.link && <input readOnly className="input mt-1 !py-1 text-xs" value={message.link} onFocus={(e) => e.currentTarget.select()} aria-label="Lien prestataire" />}
              </div>
            )}
            {openId === r.id && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-navy/5 pt-2 text-xs text-navy/70">
                {r.events.map((e, i) => (
                  <li key={i}>
                    {fmt(e.createdAt)} · {EVENT_LABELS[e.action] ?? e.action}
                    {e.actorKind === "prestataire" ? " (prestataire)" : e.actorName ? ` (${e.actorName})` : ""}
                    {e.comment ? ` — ${e.comment}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
