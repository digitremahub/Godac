"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CATEGORIES_TICPE,
  LIBELLES_CATEGORIE_COURTS,
  LIBELLES_ZONE,
  ZONES_TICPE,
  formatJour,
  type CategorieTicpe,
  type LigneBareme,
  type ZoneTicpe,
} from "@/lib/ticpe/bareme";

interface Brouillon {
  categorie: CategorieTicpe;
  zone: ZoneTicpe;
  date_debut: string;
  date_fin: string;
  taux: string;
  source: string;
  source_url: string;
  verifie_le: string;
  a_confirmer: boolean;
  note: string;
}

const vide: Brouillon = { categorie: "trm", zone: "metropole", date_debut: "", date_fin: "", taux: "", source: "", source_url: "", verifie_le: "", a_confirmer: true, note: "" };

function versBrouillon(l: LigneBareme): Brouillon {
  return {
    categorie: l.categorie,
    zone: l.zone,
    date_debut: l.date_debut,
    date_fin: l.date_fin ?? "",
    taux: l.taux_eur_hl === null ? "" : String(l.taux_eur_hl),
    source: l.source ?? "",
    source_url: l.source_url ?? "",
    verifie_le: l.verifie_le ?? "",
    a_confirmer: Boolean(l.a_confirmer),
    note: l.note ?? "",
  };
}

function corps(b: Brouillon) {
  const t = b.taux.trim().replace(",", ".");
  return JSON.stringify({
    categorie: b.categorie,
    zone: b.zone,
    date_debut: b.date_debut,
    date_fin: b.date_fin || null,
    taux_eur_hl: t === "" ? null : Number(t),
    source: b.source.trim() || null,
    source_url: b.source_url.trim() || null,
    verifie_le: b.verifie_le || null,
    a_confirmer: b.a_confirmer,
    note: b.note.trim() || null,
  });
}

function Formulaire({ initial, onEnvoyer, onAnnuler, libelle }: { initial: Brouillon; onEnvoyer: (b: Brouillon) => Promise<string | null>; onAnnuler: () => void; libelle: string }) {
  const [b, setB] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-2 rounded-lg border border-navy/10 bg-surface p-3 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErreur(await onEnvoyer(b));
        setBusy(false);
      }}
    >
      <label className="block">
        <span className="label">Activité</span>
        <select className="input" value={b.categorie} onChange={(e) => setB({ ...b, categorie: e.target.value as CategorieTicpe })}>
          {CATEGORIES_TICPE.map((c) => (
            <option key={c} value={c}>
              {LIBELLES_CATEGORIE_COURTS[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Zone</span>
        <select className="input" value={b.zone} onChange={(e) => setB({ ...b, zone: e.target.value as ZoneTicpe })}>
          {ZONES_TICPE.map((z) => (
            <option key={z} value={z}>
              {LIBELLES_ZONE[z]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Du</span>
        <input className="input" type="date" required value={b.date_debut} onChange={(e) => setB({ ...b, date_debut: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">Au (vide = en cours)</span>
        <input className="input" type="date" value={b.date_fin} onChange={(e) => setB({ ...b, date_fin: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">Taux €/hl (vide = inconnu)</span>
        <input className="input" inputMode="decimal" value={b.taux} onChange={(e) => setB({ ...b, taux: e.target.value })} />
      </label>
      <label className="block">
        <span className="label">Vérifié le</span>
        <input className="input" type="date" value={b.verifie_le} onChange={(e) => setB({ ...b, verifie_le: e.target.value })} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Source</span>
        <input className="input" value={b.source} onChange={(e) => setB({ ...b, source: e.target.value })} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">URL de la source</span>
        <input className="input" type="url" value={b.source_url} onChange={(e) => setB({ ...b, source_url: e.target.value })} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Note</span>
        <input className="input" value={b.note} onChange={(e) => setB({ ...b, note: e.target.value })} />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-4">
        <input type="checkbox" checked={b.a_confirmer} onChange={(e) => setB({ ...b, a_confirmer: e.target.checked })} />
        Afficher « à confirmer par l&apos;expert-comptable »
      </label>
      {erreur && <p className="text-sm text-orange-ink sm:col-span-4">{erreur}</p>}
      <div className="flex gap-2 sm:col-span-4">
        <button type="submit" className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy}>
          {busy ? "Enregistrement…" : libelle}
        </button>
        <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={onAnnuler}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/** Backoffice GODAC : barème TICPE global (ajout, modification ; une ligne se clôt par sa date de fin, jamais supprimée). */
export function BaremeTicpeStaff({ lignes }: { lignes: (LigneBareme & { id: string; updated_by_email?: string | null })[] }) {
  const router = useRouter();
  const [edition, setEdition] = useState<string | null>(null);

  async function envoyer(url: string, method: "POST" | "PATCH", b: Brouillon): Promise<string | null> {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: corps(b) });
    if (!r.ok) return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Erreur.";
    setEdition(null);
    router.refresh();
    return null;
  }

  const tri = [...lignes].sort((a, b) => b.date_debut.localeCompare(a.date_debut) || a.categorie.localeCompare(b.categorie) || a.zone.localeCompare(b.zone));
  return (
    <div className="flex flex-col gap-3">
      {edition === "nouvelle" ? (
        <Formulaire initial={vide} libelle="Ajouter la ligne" onAnnuler={() => setEdition(null)} onEnvoyer={(b) => envoyer("/api/godac-staff/ticpe/bareme", "POST", b)} />
      ) : (
        <button type="button" className="btn-primary self-start !px-3 !py-1.5 text-sm" onClick={() => setEdition("nouvelle")}>
          Ajouter une ligne
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {tri.map((l) => (
          <li key={l.id} className="rounded-lg border border-navy/10 p-3 text-sm">
            {edition === l.id ? (
              <Formulaire initial={versBrouillon(l)} libelle="Enregistrer" onAnnuler={() => setEdition(null)} onEnvoyer={(b) => envoyer(`/api/godac-staff/ticpe/bareme/${l.id}`, "PATCH", b)} />
            ) : (
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {LIBELLES_CATEGORIE_COURTS[l.categorie]} · {LIBELLES_ZONE[l.zone]} · {formatJour(l.date_debut)} → {l.date_fin ? formatJour(l.date_fin) : "…"} ·{" "}
                    <span className={l.taux_eur_hl === null ? "text-orange-ink" : ""}>{l.taux_eur_hl === null ? "taux à compléter" : `${l.taux_eur_hl} €/hl`}</span>
                  </p>
                  <p className="text-xs text-navy/60">
                    {l.source ?? "sans source"}
                    {l.verifie_le ? ` · vérifié le ${formatJour(l.verifie_le)}` : " · jamais vérifié"}
                    {l.a_confirmer ? " · à confirmer" : ""}
                    {l.updated_by_email ? ` · modifié par ${l.updated_by_email}` : ""}
                  </p>
                </div>
                <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEdition(l.id)}>
                  Modifier
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
