"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { LIBELLES_CHALEUR, LIBELLES_STATUT, STATUTS_RECOMMANDATION, type Chaleur, type StatutRecommandation } from "@/lib/recommandation/chaleur";

export interface RecommandationStaff {
  id: string;
  createdAt: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  message: string | null;
  consentAt: string;
  consentText: string;
  status: StatutRecommandation;
  staffNotes: string | null;
  recommandePar: string | null;
}

export interface PisteStaff {
  companyKey: string;
  companyName: string;
  chauffeurs: number;
  chaleur: Chaleur;
  lignes: RecommandationStaff[];
}

const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" });

/** Une recommandation : statut modifiable, notes internes, consentement affiché. */
function Ligne({ r }: { r: RecommandationStaff }) {
  const [statut, setStatut] = useState<StatutRecommandation>(r.status);
  const [notes, setNotes] = useState(r.staffNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; texte: string } | null>(null);

  async function enregistrer(corps: { status?: StatutRecommandation; staffNotes?: string }) {
    setBusy(true);
    setRetour(null);
    const res = await fetchGodac(`/api/godac-staff/recommandations/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corps),
    });
    setBusy(false);
    setRetour(res.ok ? { ok: true, texte: "Enregistré." } : { ok: false, texte: res.refus.message });
    return res.ok;
  }

  return (
    <li className="rounded-xl border border-navy/[0.1] p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-navy/60">
          {date(r.createdAt)}
          {r.recommandePar && <> · recommandée par {r.recommandePar}</>}
        </p>
        <label className="flex items-center gap-2 text-xs font-semibold">
          Statut
          <select
            className="input !w-auto !py-1.5"
            value={statut}
            disabled={busy}
            onChange={async (e) => {
              const avant = statut;
              const nouveau = e.target.value as StatutRecommandation;
              setStatut(nouveau);
              if (!(await enregistrer({ status: nouveau }))) setStatut(avant);
            }}
          >
            {STATUTS_RECOMMANDATION.map((s) => (
              <option key={s} value={s}>
                {LIBELLES_STATUT[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-navy/60">Contact</dt>
          <dd>{r.contactName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy/60">E-mail</dt>
          <dd className="break-all">{r.contactEmail ? <a className="text-teal-ink hover:underline" href={`mailto:${r.contactEmail}`}>{r.contactEmail}</a> : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy/60">Téléphone</dt>
          <dd>{r.contactPhone ? <a className="text-teal-ink hover:underline" href={`tel:${r.contactPhone.replace(/\s/g, "")}`}>{r.contactPhone}</a> : "—"}</dd>
        </div>
      </dl>
      {r.message && <p className="mt-2 whitespace-pre-line rounded-lg bg-navy/[0.05] px-3 py-2">{r.message}</p>}
      <p className="mt-2 text-xs text-navy/60">
        Consentement du {date(r.consentAt)} : « {r.consentText} »
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <label className="label !mb-0" htmlFor={`notes-${r.id}`}>
          Notes internes
        </label>
        <textarea id={`notes-${r.id}`} className="input" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <div className="flex items-center gap-3">
          <button type="button" className="btn-secondary !py-1.5" disabled={busy || notes.trim() === (r.staffNotes ?? "")} onClick={() => enregistrer({ staffNotes: notes })}>
            Enregistrer les notes
          </button>
          {retour && (
            <span role="status" className={`text-xs font-semibold ${retour.ok ? "text-success-ink" : "text-orange-ink"}`}>
              {retour.texte}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

/** Pistes regroupées par entreprise (déjà triées : chaudes d'abord). */
export function RecommandationsEmployeur({ pistes }: { pistes: PisteStaff[] }) {
  if (pistes.length === 0) {
    return (
      <Card>
        <p className="text-sm text-navy/70">Aucune recommandation pour le moment.</p>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {pistes.map((p) => (
        <Card key={p.companyKey}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold">{p.companyName}</h2>
            <span className={p.chauffeurs >= 2 ? "badge-orange" : "badge-neutral"}>{p.chauffeurs >= 2 ? LIBELLES_CHALEUR[p.chaleur] : LIBELLES_CHALEUR.tiede}</span>
            <span className="text-sm text-navy/65">
              {p.chauffeurs} chauffeur{p.chauffeurs > 1 ? "s" : ""} · {p.lignes.length} recommandation{p.lignes.length > 1 ? "s" : ""}
            </span>
          </div>
          <ul className="mt-3 flex flex-col gap-3">
            {p.lignes.map((r) => (
              <Ligne key={r.id} r={r} />
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
