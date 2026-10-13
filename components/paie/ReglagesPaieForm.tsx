"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { networkErrorMessage } from "@/lib/utils/network-error";

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
}

const CHAMPS: { section: string; champs: { key: keyof Reglages; label: string; suffix: string; hint?: string; optional?: boolean }[] }[] = [
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
  const [v, setV] = useState<Record<keyof Reglages, string>>(
    Object.fromEntries(Object.entries(initial).map(([k, x]) => [k, x === null ? "" : String(x)])) as Record<keyof Reglages, string>,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const body = Object.fromEntries(
        CHAMPS.flatMap((s) => s.champs).map((c) => [c.key, v[c.key] === "" ? (c.optional ? null : 0) : Number(v[c.key])]),
      );
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
      {message && <p role="status" className={`rounded-lg px-3 py-2 text-sm ${message.ok ? "bg-teal/10 text-teal-ink" : "bg-orange/10 text-orange-ink"}`}>{message.text}</p>}
      <button type="button" className="btn-primary w-fit" disabled={busy} onClick={save}>
        {busy ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  );
}
