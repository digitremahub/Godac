"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { LIBELLE_MOTIF } from "@/lib/paie/sortie";
import { networkErrorMessage } from "@/lib/utils/network-error";
import type { ElementsSortie, MotifSortie } from "@/lib/paie/types";

const eur = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface SortieEnregistree {
  exit_date: string;
  reason: MotifSortie;
  notice_type: "effectue" | "paye" | "non_paye" | "sans";
  notice_days: number | null;
  notice_amount: number | null;
  severance_amount: number | null;
  jobs_held: string | null;
  notes: string | null;
}

const PREAVIS = [
  { key: "effectue", label: "Effectué (payé normalement)" },
  { key: "paye", label: "Non effectué, payé (indemnité compensatrice)" },
  { key: "non_paye", label: "Dispensé, non payé" },
  { key: "sans", label: "Sans préavis" },
] as const;

/**
 * Sortie du salarié : saisie (employee_exits), aperçu des indemnités et
 * documents de fin de contrat (certificat de travail, solde de tout
 * compte, données pour l'attestation France Travail).
 */
export function SortieSalarie({
  userId,
  enregistree,
  calcul,
  emploiParDefaut,
  dateEntree,
}: {
  userId: string;
  enregistree: SortieEnregistree | null;
  calcul: { elements: ElementsSortie; indemniteLegale: number | null; avertissements: string[] } | null;
  emploiParDefaut: string | null;
  dateEntree: string | null;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(Boolean(enregistree));
  const [date, setDate] = useState(enregistree?.exit_date ?? "");
  const [motif, setMotif] = useState<MotifSortie>(enregistree?.reason ?? "demission");
  const [preavis, setPreavis] = useState<SortieEnregistree["notice_type"]>(enregistree?.notice_type ?? "effectue");
  const [joursPreavis, setJoursPreavis] = useState(enregistree?.notice_days?.toString() ?? "");
  const [montantPreavis, setMontantPreavis] = useState(enregistree?.notice_amount?.toString() ?? "");
  const [montantRupture, setMontantRupture] = useState(enregistree?.severance_amount?.toString() ?? "");
  const [emplois, setEmplois] = useState(enregistree?.jobs_held ?? emploiParDefaut ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const nombre = (v: string) => (v.trim() === "" ? null : Number(v));

  async function enregistrer() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/paie/sorties/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exit_date: date,
          reason: motif,
          notice_type: preavis,
          notice_days: nombre(joursPreavis),
          notice_amount: preavis === "paye" ? nombre(montantPreavis) : null,
          severance_amount: motif === "licenciement" || motif === "rupture_conventionnelle" ? nombre(montantRupture) : null,
          jobs_held: emplois.trim() || null,
          notes: enregistree?.notes ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
      setMessage({ ok: true, text: "Sortie enregistrée. Le bulletin du mois de sortie reprend les indemnités." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  if (!ouvert) {
    return (
      <Card className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg">Sortie du salarié</h2>
          <p className="text-sm text-navy/60">Fin de contrat : bulletin de sortie, certificat de travail, solde de tout compte.</p>
        </div>
        <button type="button" className="btn-secondary !py-2 text-sm" onClick={() => setOuvert(true)}>
          Préparer une sortie
        </button>
      </Card>
    );
  }

  const e = calcul?.elements;
  return (
    <Card className="mt-5 flex flex-col gap-4">
      <div>
        <h2 className="text-lg">Sortie du salarié</h2>
        <p className="text-sm text-navy/60">
          {dateEntree ? `Entré le ${new Date(`${dateEntree}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC" })}.` : "Date d'entrée inconnue (dossier salarié) : indemnité légale non calculée."}{" "}
          Le bulletin du mois de sortie retire les jours après la sortie et ajoute les indemnités ci-dessous.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="label">Date de fin du contrat</span>
          <input className="input" type="date" value={date} onChange={(ev) => setDate(ev.target.value)} />
        </label>
        <label className="block">
          <span className="label">Motif</span>
          <select className="input" value={motif} onChange={(ev) => setMotif(ev.target.value as MotifSortie)}>
            {(Object.keys(LIBELLE_MOTIF) as MotifSortie[]).map((m) => (
              <option key={m} value={m}>
                {LIBELLE_MOTIF[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Préavis</span>
          <select className="input" value={preavis} onChange={(ev) => setPreavis(ev.target.value as SortieEnregistree["notice_type"])}>
            {PREAVIS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {preavis !== "sans" && (
          <label className="block">
            <span className="label">Durée du préavis</span>
            <input className="input tabular-nums" type="number" min="0" step="1" value={joursPreavis} onChange={(ev) => setJoursPreavis(ev.target.value)} placeholder="jours" />
          </label>
        )}
        {preavis === "paye" && (
          <label className="block">
            <span className="label">Indemnité de préavis (brut)</span>
            <input className="input tabular-nums" type="number" min="0" step="0.01" value={montantPreavis} onChange={(ev) => setMontantPreavis(ev.target.value)} placeholder="vide = salaire × jours ÷ 30" />
          </label>
        )}
        {(motif === "licenciement" || motif === "rupture_conventionnelle") && (
          <label className="block">
            <span className="label">{motif === "licenciement" ? "Indemnité (si supérieure à la légale)" : "Indemnité convenue"}</span>
            <input className="input tabular-nums" type="number" min="0" step="0.01" value={montantRupture} onChange={(ev) => setMontantRupture(ev.target.value)} />
          </label>
        )}
        <label className="block sm:col-span-2 lg:col-span-3">
          <span className="label">Emplois occupés (certificat de travail, un par ligne)</span>
          <textarea className="input min-h-[4rem]" value={emplois} onChange={(ev) => setEmplois(ev.target.value)} placeholder="Conducteur livreur VL, du 06/01/2020 au 30/09/2026" />
        </label>
      </div>
      {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-teal/10 text-teal-ink" : "bg-orange/10 text-orange-ink"}`}>{message.text}</p>}
      <button type="button" className="btn-primary w-fit !py-2" disabled={busy || !date} onClick={enregistrer}>
        {busy ? "Enregistrement…" : "Enregistrer la sortie"}
      </button>

      {enregistree && e && (
        <div className="flex flex-col gap-2 border-t border-navy/[0.08] pt-3 text-sm">
          <p className="label !mb-0">Indemnités calculées (sortie enregistrée)</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {[
              ["Indemnité compensatrice de congés payés", e.iccp ? `${eur(e.iccp.montant)} € (${e.iccp.jours} j, ${e.iccp.methode === "dixieme" ? "dixième" : "maintien"})` : "—"],
              ["Indemnité compensatrice de préavis", e.preavis ? `${eur(e.preavis.montant)} €` : "—"],
              ["Indemnité légale de licenciement (référence)", calcul?.indemniteLegale !== null && calcul?.indemniteLegale !== undefined ? `${eur(calcul.indemniteLegale)} €` : "—"],
              [e.rupture?.libelle ?? "Indemnité de rupture", e.rupture ? `${eur(e.rupture.montant)} € dont ${eur(e.rupture.exonereeSocial)} € exonérés de cotisations` : "—"],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-3 border-b border-navy/[0.06] py-1">
                <dt className="text-navy/65">{l}</dt>
                <dd className="text-right tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {calcul?.avertissements.map((a) => (
            <p key={a} className="rounded-lg bg-gold/15 px-3 py-2 text-xs">
              {a}
            </p>
          ))}
          <p className="label !mb-0 mt-2">Documents</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary !py-1.5 text-sm" href={`/api/paie/sorties/${userId}/documents?doc=certificat`} target="_blank" rel="noopener">
              Certificat de travail
            </a>
            <a className="btn-secondary !py-1.5 text-sm" href={`/api/paie/sorties/${userId}/documents?doc=solde`} target="_blank" rel="noopener">
              Reçu pour solde de tout compte
            </a>
            <a className="btn-secondary !py-1.5 text-sm" href={`/api/paie/sorties/${userId}/documents?doc=france-travail`} target="_blank" rel="noopener">
              Données pour l&apos;attestation France Travail
            </a>
          </div>
          <p className="text-xs text-navy/55">
            L&apos;attestation employeur officielle est transmise par la DSN : la fiche France Travail n&apos;en rassemble que les données. Traitement social et
            fiscal des indemnités de rupture simplifié, à vérifier par le comptable.
          </p>
        </div>
      )}
    </Card>
  );
}
