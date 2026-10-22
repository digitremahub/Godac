"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { networkErrorMessage } from "@/lib/utils/network-error";
import { LIBELLE_SOURCE_HEURES, type SourceHeures } from "@/lib/paie/heures";

export interface Reglages {
  headcount: number;
  accident_rate: number;
  mobility_rate: number;
  prevoyance_salarial_rate: number;
  prevoyance_patronal_rate: number;
  mutuelle_salarial_amount: number;
  mutuelle_patronal_amount: number;
  meal_allowance: number | null;
  single_meal_allowance: number | null;
  snack_allowance: number | null;
  overnight_allowance: number | null;
  health_pmss_salarial_rate: number | null;
  health_pmss_patronal_rate: number | null;
  ccn_salarial_rate: number | null;
  ccn_patronal_rate: number | null;
  dfs_rate: number | null;
  dfs_enabled: boolean;
  sick_pay_min_seniority_months: number | null;
  sick_pay_waiting_days: number | null;
  sick_pay_waiting_days_at: number | null;
  sick_pay_rate_1: number | null;
  sick_pay_rate_2: number | null;
  sick_pay_base_days: number | null;
  sick_pay_step_days: number | null;
  sick_pay_step_years: number | null;
  sick_pay_max_days: number | null;
  subrogation_enabled: boolean;
  /** Source des heures du bulletin (lib/paie/heures.ts). */
  hours_source: SourceHeures;
}

type CleNumerique = Exclude<keyof Reglages, "dfs_enabled" | "subrogation_enabled" | "hours_source">;

const CHAMPS: { section: string; champs: { key: CleNumerique; label: string; suffix: string; hint?: string; optional?: boolean }[] }[] = [
  {
    section: "Entreprise",
    champs: [
      { key: "headcount", label: "Effectif", suffix: "sal.", hint: "Détermine FNAL, formation, versement mobilité et déduction heures sup." },
      { key: "accident_rate", label: "Taux accident du travail", suffix: "%", hint: "Notifié par la CARSAT (compte AT/MP sur net-entreprises)." },
      { key: "mobility_rate", label: "Versement mobilité", suffix: "%", hint: "Selon la commune, à partir de 11 salariés." },
    ],
  },
  {
    section: "Prévoyance et santé",
    champs: [
      { key: "prevoyance_salarial_rate", label: "Prévoyance — part salarié", suffix: "% T1", hint: "CARCEPT Prévoyance (conducteurs TRM) : 1,20 % réparti 50/50, soit 0,60 % chacun." },
      { key: "prevoyance_patronal_rate", label: "Prévoyance — part employeur", suffix: "% T1" },
      { key: "mutuelle_salarial_amount", label: "Mutuelle — part salarié", suffix: "€/mois" },
      { key: "mutuelle_patronal_amount", label: "Mutuelle — part employeur", suffix: "€/mois", hint: "Au moins 50 % de la cotisation." },
      { key: "health_pmss_salarial_rate", label: "Santé au forfait — part salarié", suffix: "% PMSS", optional: true, hint: "Modèle transport : 2,01 % du PMSS. Renseigné, il remplace les montants de mutuelle." },
      { key: "health_pmss_patronal_rate", label: "Santé au forfait — part employeur", suffix: "% PMSS", optional: true },
    ],
  },
  {
    section: "Convention collective des transports (IDCC 16)",
    champs: [
      { key: "ccn_salarial_rate", label: "Cotisations conventionnelles — salarié", suffix: "%", optional: true, hint: "Modèle : 0,025 % du brut." },
      { key: "ccn_patronal_rate", label: "Cotisations conventionnelles — employeur", suffix: "%", optional: true, hint: "Modèle : 0,525 % du brut." },
      { key: "dfs_rate", label: "Abattement DFS (conducteurs)", suffix: "%", optional: true, hint: "17 % : affiché pour mémoire sur le bulletin. Cochez ci-dessous pour l'appliquer aux bases." },
    ],
  },
  {
    section: "Maintien de salaire en cas d'arrêt",
    champs: [
      { key: "sick_pay_min_seniority_months", label: "Ancienneté minimale", suffix: "mois", optional: true, hint: "Légal : 12 mois (art. L1226-1)." },
      { key: "sick_pay_waiting_days", label: "Carence employeur — maladie, trajet", suffix: "jours", optional: true, hint: "Légal : 7 jours (art. D1226-3)." },
      { key: "sick_pay_waiting_days_at", label: "Carence employeur — AT / maladie pro.", suffix: "jours", optional: true, hint: "Légal : aucune." },
      { key: "sick_pay_rate_1", label: "Taux de la 1re période", suffix: "%", optional: true, hint: "Légal : 90 %." },
      { key: "sick_pay_rate_2", label: "Taux de la 2e période", suffix: "%", optional: true, hint: "Légal : 66,66 %." },
      { key: "sick_pay_base_days", label: "Durée de chaque période", suffix: "jours", optional: true, hint: "Légal : 30 jours de 1 à 5 ans d'ancienneté." },
      { key: "sick_pay_step_days", label: "Jours ajoutés par tranche", suffix: "jours", optional: true, hint: "Légal : + 10 jours par période…" },
      { key: "sick_pay_step_years", label: "Tranche d'ancienneté", suffix: "ans", optional: true, hint: "…par tranche de 5 ans au-delà de la 1re année." },
      { key: "sick_pay_max_days", label: "Durée maximale par période", suffix: "jours", optional: true, hint: "Légal : 90 jours." },
    ],
  },
  {
    section: "Frais de déplacement (laisser vide = barème conventionnel)",
    champs: [
      { key: "meal_allowance", label: "Indemnité de repas", suffix: "€", optional: true },
      { key: "single_meal_allowance", label: "Repas unique", suffix: "€", optional: true },
      { key: "snack_allowance", label: "Casse-croûte", suffix: "€", optional: true },
      { key: "overnight_allowance", label: "Grand déplacement (découcher)", suffix: "€", optional: true },
    ],
  },
];

export function ReglagesPaieForm({ initial, defauts }: { initial: Reglages; defauts: Record<string, number> }) {
  const router = useRouter();
  const [v, setV] = useState<Record<CleNumerique, string>>(
    Object.fromEntries(Object.entries(initial).filter(([k]) => k !== "dfs_enabled" && k !== "subrogation_enabled" && k !== "hours_source").map(([k, x]) => [k, x === null ? "" : String(x)])) as Record<CleNumerique, string>,
  );
  const [dfsActive, setDfsActive] = useState(initial.dfs_enabled);
  const [subrogation, setSubrogation] = useState(initial.subrogation_enabled);
  const [sourceHeures, setSourceHeures] = useState<SourceHeures>(initial.hours_source);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const body = {
        ...Object.fromEntries(CHAMPS.flatMap((s) => s.champs).map((c) => [c.key, v[c.key] === "" ? (c.optional ? null : 0) : Number(v[c.key])])),
        dfs_enabled: dfsActive,
        subrogation_enabled: subrogation,
        hours_source: sourceHeures,
      };
      const res = await fetch("/api/paie/parametres", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Enregistrement impossible");
      setMessage({ ok: true, text: "Réglages enregistrés." });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: networkErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {CHAMPS.map((s) => (
        <Card key={s.section} className="flex flex-col gap-3">
          <h2 className="text-lg">{s.section}</h2>
          {s.section.startsWith("Maintien") && (
            <p role="note" className="-mt-1 rounded-lg bg-gold/15 px-3 py-2 text-xs text-navy">
              Valeurs légales par défaut (art. D1226-1 s. du code du travail). Les dispositions de la convention collective des transports (IDCC 16,
              accords ouvriers) ne sont pas préremplies : à vérifier par votre comptable et à saisir ici. Le bulletin applique, jour par jour, le plus
              favorable du maintien légal et de ces valeurs.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {s.champs.map((c) => (
              <label key={c.key} className="block">
                <span className="label">{c.label}</span>
                <span className="relative block">
                  <input
                    className="input pr-16 tabular-nums"
                    type="number"
                    step="0.001"
                    inputMode="decimal"
                    value={v[c.key]}
                    placeholder={c.optional && defauts[c.key] !== undefined ? String(defauts[c.key]) : undefined}
                    onChange={(e) => setV({ ...v, [c.key]: e.target.value })}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-navy/50">{c.suffix}</span>
                </span>
                {c.hint && <span className="mt-1 block text-xs text-navy/55">{c.hint}</span>}
              </label>
            ))}
          </div>
        </Card>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={dfsActive} onChange={(e) => setDfsActive(e.target.checked)} />
        Appliquer l&apos;abattement DFS aux bases de cotisations (sinon affiché pour mémoire seulement)
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={subrogation} onChange={(e) => setSubrogation(e.target.checked)} />
        Subrogation par défaut : l&apos;entreprise perçoit les IJSS et les reverse sur le bulletin (modifiable sur chaque bulletin)
      </label>
      <Card className="flex flex-col gap-2">
        <h2 className="text-lg">Heures du bulletin</h2>
        <p className="text-xs text-navy/60">
          Recommandé : début au pointage d&apos;arrivée, sinon à l&apos;heure prévue au planning (picking au dépôt) ; fin au pointage de sortie, sinon au
          retour de la dernière tournée. Personnel de bureau : pointage, sinon horaires prévus (signalés). Pauses pointées déduites. Le détail jour
          par jour et les alertes s&apos;affichent sur chaque bulletin ; le total reste modifiable.
        </p>
        {(Object.keys(LIBELLE_SOURCE_HEURES) as SourceHeures[]).map((k) => (
          <label key={k} className="flex min-h-[44px] items-center gap-2 text-sm">
            <input type="radio" name="hours_source" checked={sourceHeures === k} onChange={() => setSourceHeures(k)} />
            {LIBELLE_SOURCE_HEURES[k]}
          </label>
        ))}
      </Card>
      {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-teal/10 text-teal-ink" : "bg-orange/10 text-orange-ink"}`}>{message.text}</p>}
      <button type="button" className="btn-primary w-fit" disabled={busy} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}
