"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card } from "@/components/ui";
import { LIBELLE_SOURCE_ESTIMATION, type PointageARegulariser } from "@/lib/time-clock/regularisation";
import { networkErrorMessage } from "@/lib/utils/network-error";

const jourHeure = (iso: string) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const heureParis = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });

async function envoyer(corps: Record<string, unknown>) {
  const res = await fetch("/api/time-clock/regulariser", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Régularisation impossible.");
}

function Ligne({ p, moi }: { p: PointageARegulariser; moi: string }) {
  const router = useRouter();
  const [heure, setHeure] = useState(p.sortieEstimee ? heureParis(p.sortieEstimee) : "");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function regulariser() {
    setBusy(true);
    setErreur(null);
    try {
      await envoyer({ action: "corriger", id: p.id, heureSortie: heure, motif });
      router.refresh();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 border-t border-navy/5 py-3 first:border-t-0 first:pt-0">
      <div className="text-sm">
        <span className="font-semibold">{p.nom}</span>
        {p.userId === moi && <span className="ml-2 text-xs text-navy/60">(vous)</span>}
        <p className="text-navy/70">
          Entrée le {jourHeure(p.entree)} · {p.sortieEstimee ? `sortie estimée à ${heureParis(p.sortieEstimee)}` : "aucune estimation possible"}
          {p.source && <span className="text-xs text-navy/55"> ({LIBELLE_SOURCE_ESTIMATION[p.source]})</span>}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_auto] sm:items-end">
        <label className="block">
          <span className="label">Heure de sortie</span>
          <input className="input" type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Motif (obligatoire)</span>
          <input className="input" value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} placeholder="Ex. oubli de badge confirmé par le salarié" />
        </label>
        <button type="button" className="btn-dark" disabled={busy || !heure || motif.trim().length < 3} onClick={regulariser}>
          {busy ? "…" : "Régulariser"}
        </button>
      </div>
      {erreur && (
        <p role="alert" className="text-sm" style={{ color: "#d62718" }}>
          {erreur}
        </p>
      )}
    </li>
  );
}

function AjoutManquant({ salaries }: { salaries: { id: string; nom: string }[] }) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [jour, setJour] = useState("");
  const [entree, setEntree] = useState("");
  const [sortie, setSortie] = useState("");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ajouter() {
    setBusy(true);
    setErreur(null);
    try {
      await envoyer({ action: "ajouter", userId, jour, heureEntree: entree, heureSortie: sortie, motif });
      setUserId("");
      setJour("");
      setEntree("");
      setSortie("");
      setMotif("");
      router.refresh();
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 border-t border-navy/5 pt-3">
      <summary className="cursor-pointer text-sm font-semibold">Ajouter un pointage oublié (entrée non badgée)</summary>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Salarié</span>
          <select className="input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choisir…</option>
            {salaries.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nom}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Jour</span>
          <input className="input" type="date" value={jour} onChange={(e) => setJour(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="label">Entrée</span>
            <input className="input" type="time" value={entree} onChange={(e) => setEntree(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Sortie</span>
            <input className="input" type="time" value={sortie} onChange={(e) => setSortie(e.target.value)} />
          </label>
        </div>
        <label className="block sm:col-span-2">
          <span className="label">Motif (obligatoire)</span>
          <input className="input" value={motif} maxLength={500} onChange={(e) => setMotif(e.target.value)} />
        </label>
        <button type="button" className="btn-dark w-fit" disabled={busy || !userId || !jour || !entree || !sortie || motif.trim().length < 3} onClick={ajouter}>
          {busy ? "…" : "Ajouter le pointage"}
        </button>
      </div>
      {erreur && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "#d62718" }}>
          {erreur}
        </p>
      )}
    </details>
  );
}

/**
 * Pointages à régulariser (sortie oubliée, clos automatiquement avec une
 * heure estimée) : l'encadrement saisit l'heure de sortie et un motif, en un
 * geste. Chaque correction est tracée (qui, avant / après, motif).
 */
export function PointagesARegulariser({ pointages, salaries, moi }: { pointages: PointageARegulariser[]; salaries: { id: string; nom: string }[]; moi: string }) {
  return (
    <Card className="mb-6">
      <h3 className="mb-1 text-base">Pointages à régulariser</h3>
      <p className="mb-3 text-xs text-navy/60">
        Une sortie non badgée est close la nuit avec une heure estimée. Saisissez l&apos;heure réelle et un motif : la correction est tracée. On ne régularise pas son propre pointage (sauf direction, avec trace).
      </p>
      {pointages.length === 0 ? <p className="text-sm text-navy/60">Aucun pointage à régulariser.</p> : <ul>{pointages.map((p) => <Ligne key={p.id} p={p} moi={moi} />)}</ul>}
      <AjoutManquant salaries={salaries} />
    </Card>
  );
}
