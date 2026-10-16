"use client";

import { useState } from "react";
import { SMS_ARRIVEE, api, type Stop } from "@/components/colis/commun";
import { lienSms, lienTel } from "@/lib/colis/telephone";

type EventItem = {
  id: string;
  event_type: string;
  details: string | null;
  created_at: string;
  previous_value?: unknown;
  new_value?: unknown;
};

const LABELS: Record<string, string> = {
  stop_created: "Arrêt ajouté à la tournée",
  status_changed: "Changement de statut",
  delivered: "Livraison / ramasse effectuée",
  failed: "Échec de livraison",
  reopened: "Arrêt rouvert",
  reordered: "Ordre de tournée modifié",
  list_changed: "Liste de tournée modifiée",
  pickup_count_recorded: "Nombre de colis ramassés enregistré",
  sms_prepared: "SMS préparé",
  sms_confirmed_sent: "Envoi du SMS confirmé",
  call_started: "Appel lancé",
  call_confirmed: "Appel effectué confirmé",
  note: "Note",
};

function dateHeure(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Paris",
  }).format(new Date(value));
}

export function HistoriqueArret({ stop }: { stop: Stop }) {
  const [ouvert, setOuvert] = useState(false);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [charge, setCharge] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function charger() {
    setCharge(true);
    try {
      const result = await api<{ events: EventItem[] }>(`/api/colis/arrets/${stop.id}/historique`);
      setEvents(result.events);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Historique indisponible.");
    } finally {
      setCharge(false);
    }
  }

  async function ouvrirHistorique() {
    const next = !ouvert;
    setOuvert(next);
    if (next) await charger();
  }

  async function journaliser(type: "sms_prepared" | "sms_confirmed_sent" | "call_started" | "call_confirmed") {
    setBusy(type);
    setMessage(null);
    try {
      await api(`/api/colis/arrets/${stop.id}/historique`, {
        method: "POST",
        body: JSON.stringify({ event_type: type }),
      });
      await charger();
      setMessage(type === "sms_confirmed_sent" ? "Envoi du SMS enregistré." :
        type === "call_confirmed" ? "Appel enregistré." :
        type === "sms_prepared" ? "Ouverture du SMS enregistrée. Confirmez après l'envoi." : "Lancement de l'appel enregistré. Confirmez après l'appel.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Impossible d'enregistrer l'action.");
    } finally {
      setBusy(null);
    }
  }

  async function preparerSms() {
    await journaliser("sms_prepared");
    window.location.href = lienSms(stop.phone!, SMS_ARRIVEE);
  }

  async function lancerAppel() {
    await journaliser("call_started");
    window.location.href = lienTel(stop.phone!);
  }

  return (
    <div className="mt-2 pl-9">
      <button type="button" className="btn-secondary !px-3 !py-2 text-sm font-semibold" onClick={ouvrirHistorique} aria-expanded={ouvert}>
        {ouvert ? "Masquer l’historique des actions" : "📋 Voir l’historique des actions"}
      </button>
      {ouvert && (
        <div className="mt-2 rounded-xl border border-navy/10 bg-surface p-3">
          {stop.phone && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" className="btn-secondary !px-3 !py-2 text-xs" disabled={busy !== null} onClick={preparerSms}>Préparer SMS</button>
              <button type="button" className="btn-secondary !px-3 !py-2 text-xs" disabled={busy !== null} onClick={lancerAppel}>Appeler</button>
              <button type="button" className="btn-ghost !px-2 !py-2 text-xs" disabled={busy !== null} onClick={() => journaliser("sms_confirmed_sent")}>Confirmer SMS envoyé</button>
              <button type="button" className="btn-ghost !px-2 !py-2 text-xs" disabled={busy !== null} onClick={() => journaliser("call_confirmed")}>Confirmer appel effectué</button>
            </div>
          )}
          {message && <p className="mb-2 text-xs text-navy/70" role="status">{message}</p>}
          {charge ? <p className="text-xs text-navy/60">Chargement de l'historique…</p> :
            events.length === 0 ? <p className="text-xs text-navy/60">Aucun événement enregistré pour le moment.</p> :
            <ol className="space-y-2">
              {events.map((event) => (
                <li key={event.id} className="border-l-2 border-teal/50 pl-2">
                  <p className="text-xs font-semibold">{LABELS[event.event_type] ?? event.event_type}</p>
                  <p className="text-[11px] text-navy/60">{dateHeure(event.created_at)}</p>
                  {event.details && <p className="text-xs text-navy/75">{event.details}</p>}
                </li>
              ))}
            </ol>}
          <p className="mt-3 text-[11px] text-navy/55">Les confirmations SMS/appel sont déclaratives : GODAC enregistre votre confirmation, mais ne peut pas vérifier l'envoi ou la conversation téléphonique via l'application native.</p>
        </div>
      )}
    </div>
  );
}
