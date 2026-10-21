"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { BadgeConfiance, Commentaires, type CommentaireVue } from "@/components/rattachement/Commentaires";
import { libelleSuggestionAmende } from "@/lib/rattachement/amende";
import { dateParis, heureParis, montantEuros } from "@/lib/rattachement/format";
import { networkErrorMessage } from "@/lib/utils/network-error";

export interface CandidatVue {
  driverId: string;
  driverName: string;
  planningEntryId: string | null;
  tourNumber: string | null;
  debut: string | null;
  fin: string | null;
  confiance: string;
  raison: string;
  gps: { at: string; lat: number; lng: number } | null;
}

export type StatutAmende = "pending_identification" | "identified" | "contested" | "paid" | "dismissed";

export interface FineRow {
  id: string;
  infraction_at: string;
  amount: number;
  reduced_amount: number | null;
  payment_deadline: string | null;
  location: string | null;
  reference: string | null;
  status: StatutAmende;
  notified_at: string | null;
  vehicles: { registration: string } | null;
  driver_id: string | null;
  driver: { full_name: string } | null;
  suggested_driver_id: string | null;
  suggested_driver_name: string | null;
  suggested_tour_number: string | null;
  match_confidence: string | null;
  raison: string | null;
  candidats: CandidatVue[];
  documents: number;
  validated_at: string | null;
  validated_by_name: string | null;
  commentaires: CommentaireVue[];
}

export const STATUT_AMENDE: Record<StatutAmende, { label: string; cls: string }> = {
  pending_identification: { label: "À traiter", cls: "badge-gold" },
  identified: { label: "Responsable désigné", cls: "badge-teal" },
  contested: { label: "Contestée", cls: "badge-neutral" },
  paid: { label: "Réglée", cls: "badge-teal" },
  dismissed: { label: "Classée", cls: "badge-neutral" },
};

const ONGLETS = [
  { key: "a_traiter", label: "À traiter", statuts: ["pending_identification"] },
  { key: "designees", label: "Responsable désigné", statuts: ["identified", "contested"] },
  { key: "closes", label: "Réglées / classées", statuts: ["paid", "dismissed"] },
] as const;

async function patch(id: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/fines/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Action impossible");
  return json;
}

function FicheAmende({ f, chauffeurs, lectureSeule, moi, focus }: { f: FineRow; chauffeurs: { id: string; name: string }[]; lectureSeule: boolean; moi: string; focus: boolean }) {
  const router = useRouter();
  const [driver, setDriver] = useState(f.driver_id ?? f.suggested_driver_id ?? "");
  const [corriger, setCorriger] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const immat = f.vehicles?.registration ?? null;
  const suggestion = f.candidats.find((c) => c.driverId === f.suggested_driver_id) ?? null;
  const ouverte = f.status === "pending_identification" || f.status === "identified" || f.status === "contested";

  async function run(body: Record<string, unknown>, ok?: (json: Record<string, unknown>) => string | null) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const json = await patch(f.id, body);
      setInfo(ok?.(json) ?? null);
      setCorriger(false);
      router.refresh();
    } catch (e) {
      setError(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const candidatChoisi = f.candidats.find((c) => c.driverId === driver);
  const choix = (
    <div className="flex flex-col gap-2 rounded-xl bg-navy/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeConfiance confiance={f.match_confidence} />
        {f.raison && <span className="text-xs text-navy/60">{f.raison}</span>}
      </div>
      {suggestion ? (
        <p className="text-sm font-medium">{libelleSuggestionAmende(suggestion, immat)}</p>
      ) : f.suggested_driver_name ? (
        <p className="text-sm font-medium">
          Suggestion : {f.suggested_driver_name}
          {f.suggested_tour_number ? `, tournée n°${f.suggested_tour_number}` : ""}
        </p>
      ) : (
        <p className="text-sm text-navy/70">Aucune suggestion automatique : choisissez le chauffeur à la main.</p>
      )}
      {f.candidats.length > 1 && (
        <ul className="text-xs text-navy/70">
          {f.candidats.map((c) => (
            <li key={`${c.driverId}-${c.planningEntryId}`}>
              • {c.driverName} — {c.confiance === "exact" ? "exact" : "probable"} : {c.raison}
              {c.debut ? ` (${heureParis(c.debut)}–${c.fin ? heureParis(c.fin) : "en cours"})` : ""}
            </li>
          ))}
        </ul>
      )}
      {suggestion?.gps && (
        <a className="text-xs text-teal-ink underline" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${suggestion.gps.lat}&mlon=${suggestion.gps.lng}#map=17/${suggestion.gps.lat}/${suggestion.gps.lng}`}>
          Position GPS à {heureParis(suggestion.gps.at)}
        </a>
      )}
      {!lectureSeule && (
        <>
          <label className="block">
            <span className="label">Chauffeur responsable</span>
            <select className="input" value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">— Choisir —</option>
              {chauffeurs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.id === f.suggested_driver_id ? " (suggéré)" : f.candidats.some((c) => c.driverId === d.id) ? " (candidat)" : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary !py-2 text-sm"
              disabled={busy || !driver}
              onClick={() => run({ action: "valider", driver_id: driver, planning_entry_id: candidatChoisi?.planningEntryId ?? null }, () => "Responsable validé : notification envoyée.")}
            >
              Valider le responsable et notifier
            </button>
            <button
              type="button"
              className="btn-secondary !py-2 text-sm"
              disabled={busy}
              onClick={() => run({ action: "resuggerer" }, (j) => (j.suggestion ? `Nouvelle suggestion : ${(j.suggestion as { name: string }).name}.` : `${(j.raison as string) ?? "Aucun chauffeur trouvé."}`))}
            >
              Relancer la recherche
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div id={`amende-${f.id}`}>
    <Card className={`flex flex-col gap-3 ${focus ? "ring-2 ring-teal" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg font-bold">{immat ?? "Véhicule non renseigné"}</p>
          <p className="text-sm text-navy/65">
            {dateParis(f.infraction_at)} à {heureParis(f.infraction_at)}
            {f.location ? ` · ${f.location}` : ""}
          </p>
        </div>
        <span className={STATUT_AMENDE[f.status]?.cls ?? "badge-neutral"}>{STATUT_AMENDE[f.status]?.label ?? f.status}</span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <span>
          <strong>{montantEuros(f.amount)}</strong>
          {f.reduced_amount !== null ? ` (minoré ${montantEuros(f.reduced_amount)})` : ""}
        </span>
        {f.payment_deadline && <span>À régler avant le {dateParis(f.payment_deadline)}</span>}
        {f.reference && <span>Avis n°{f.reference}</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {f.documents === 0 && <span className="text-xs text-orange-ink">Avis non joint</span>}
        {Array.from({ length: f.documents }, (_, i) => (
          <a key={i} href={`/api/fines/${f.id}/piece?i=${i}`} target="_blank" rel="noreferrer" className="btn-ghost !px-2 !py-1 text-xs text-teal-ink">
            📄 Avis{f.documents > 1 ? ` ${i + 1}` : ""}
          </a>
        ))}
      </div>

      {f.status === "pending_identification" ? (
        choix
      ) : (
        <>
          <p className="text-sm">
            Responsable : <strong>{f.driver?.full_name ?? "—"}</strong>
            {f.validated_at ? ` · validé le ${dateParis(f.validated_at)}${f.validated_by_name ? ` par ${f.validated_by_name}` : ""}` : ""}
            {f.notified_at ? " · notifié" : ""}
          </p>
          {corriger && choix}
          {!lectureSeule && ouverte && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary !py-2 text-sm" disabled={busy} onClick={() => run({ status: "paid" })}>
                Marquer réglée
              </button>
              {f.status !== "contested" && (
                <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => run({ status: "contested" })}>
                  Contester
                </button>
              )}
              <button type="button" className="btn-secondary !py-2 text-sm" disabled={busy} onClick={() => run({ status: "dismissed" })}>
                Classer
              </button>
              <button type="button" className="btn-ghost !py-2 text-sm" disabled={busy} onClick={() => setCorriger((v) => !v)}>
                {corriger ? "Fermer" : "Corriger le responsable"}
              </button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert" className="text-sm text-orange-ink">{error}</p>}
      {info && <p role="status" className="text-sm text-teal-ink">{info}</p>}

      {(f.commentaires.length > 0 || (!lectureSeule && f.driver_id)) && (
        <details open={f.commentaires.length > 0 && focus} className="rounded-xl border border-navy/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Échanges avec le chauffeur ({f.commentaires.length})</summary>
          <div className="mt-2">
            <Commentaires api={`/api/fines/${f.id}`} routePiece="piece" commentaires={f.commentaires} moi={moi} placeholder="Message au chauffeur…" ouvert={!lectureSeule && Boolean(f.driver_id)} />
          </div>
        </details>
      )}
    </Card>
    </div>
  );
}

/** Fiches d'amendes de l'encadrement (direction ; managers sur les véhicules de leur service, RLS). Comptable : lecture seule. */
export function FinesTable({
  fines,
  lectureSeule = false,
  chauffeurs = [],
  moi = "",
  focusId = null,
}: {
  fines: FineRow[];
  lectureSeule?: boolean;
  chauffeurs?: { id: string; name: string }[];
  moi?: string;
  focusId?: string | null;
}) {
  const ongletFocus = focusId ? ONGLETS.find((o) => (o.statuts as readonly string[]).includes(fines.find((f) => f.id === focusId)?.status ?? ""))?.key : undefined;
  const [onglet, setOnglet] = useState<(typeof ONGLETS)[number]["key"]>(ongletFocus ?? "a_traiter");
  useEffect(() => {
    if (focusId) document.getElementById(`amende-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId]);
  const tab = ONGLETS.find((o) => o.key === onglet)!;
  const visibles = fines.filter((f) => (tab.statuts as readonly string[]).includes(f.status));

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex flex-wrap gap-2">
        {ONGLETS.map((o) => {
          const n = fines.filter((f) => (o.statuts as readonly string[]).includes(f.status)).length;
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
          {visibles.map((f) => (
            <FicheAmende key={`${f.id}-${f.status}-${f.suggested_driver_id}`} f={f} chauffeurs={chauffeurs} lectureSeule={lectureSeule} moi={moi} focus={f.id === focusId} />
          ))}
        </div>
      )}
    </div>
  );
}
