"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
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
import { MENTION_A_CONFIRMER } from "@/lib/ticpe/reglages";

const taux = (t: number | null) => (t === null ? "à compléter" : `${t.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/hl`);

/** Barème GODAC en lecture (écran Réglages TICPE de l'organisation). */
export function TableBaremeTicpe({ bareme }: { bareme: LigneBareme[] }) {
  const tri = [...bareme].sort((a, b) => b.date_debut.localeCompare(a.date_debut) || a.categorie.localeCompare(b.categorie) || a.zone.localeCompare(b.zone));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-navy/60">
          <tr>
            <th className="pb-2">Période</th>
            <th className="pb-2">Activité</th>
            <th className="pb-2">Zone</th>
            <th className="pb-2 text-right">Taux</th>
            <th className="pb-2">Source</th>
          </tr>
        </thead>
        <tbody>
          {tri.map((l, i) => (
            <tr key={l.id ?? i} className="border-t border-navy/5 align-top">
              <td className="py-2">
                {formatJour(l.date_debut)} → {l.date_fin ? formatJour(l.date_fin) : "…"}
              </td>
              <td className="py-2">{LIBELLES_CATEGORIE_COURTS[l.categorie]}</td>
              <td className="py-2">{LIBELLES_ZONE[l.zone]}</td>
              <td className={`py-2 text-right tabular-nums ${l.taux_eur_hl === null ? "text-orange-ink" : ""}`}>{taux(l.taux_eur_hl)}</td>
              <td className="py-2 text-xs text-navy/65">
                {l.source_url ? (
                  <a href={l.source_url} target="_blank" rel="noreferrer" className="text-teal-ink hover:underline">
                    {l.source ?? "source"}
                  </a>
                ) : (
                  (l.source ?? "—")
                )}
                {l.verifie_le && <> · vérifié le {formatJour(l.verifie_le)}</>}
                {l.a_confirmer && <> · {MENTION_A_CONFIRMER}</>}
                {l.note && <p>{l.note}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface SurchargeAffichee {
  id: string;
  categorie: CategorieTicpe;
  zone: ZoneTicpe;
  date_debut: string;
  date_fin: string | null;
  taux_eur_hl: number;
  motif: string;
  created_at?: string;
  auteur?: string | null;
  revoked_at?: string | null;
}

/** Taux particuliers de l'organisation : liste, ajout (avec motif), révocation. */
export function SurchargesTicpe({ surcharges, modifiable }: { surcharges: SurchargeAffichee[]; modifiable: boolean }) {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [f, setF] = useState({ categorie: "trm" as CategorieTicpe, zone: "metropole" as ZoneTicpe, date_debut: "", date_fin: "", taux: "", motif: "" });
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function ajouter(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac("/api/ticpe/surcharges", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categorie: f.categorie,
        zone: f.zone,
        date_debut: f.date_debut,
        date_fin: f.date_fin || null,
        taux_eur_hl: Number(f.taux.replace(",", ".")),
        motif: f.motif,
      }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setOuvert(false);
    setF({ ...f, date_debut: "", date_fin: "", taux: "", motif: "" });
    router.refresh();
  }

  async function revoquer(id: string) {
    const ok = await confirmer({
      titre: "Révoquer ce taux particulier ?",
      message: "Le barème GODAC s'appliquera de nouveau. La ligne reste visible pour la traçabilité.",
      action: "Révoquer",
    });
    if (!ok) return;
    setRefus(null);
    const r = await fetchGodac(`/api/ticpe/surcharges/${id}`, { method: "PATCH" });
    if (!r.ok) return setRefus(r.refus);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      {surcharges.length === 0 ? (
        <p className="text-sm text-navy/60">Aucun taux particulier : le barème GODAC s&apos;applique.</p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {surcharges.map((s) => (
            <li key={s.id} className={`rounded-lg border border-navy/10 p-3 ${s.revoked_at ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {LIBELLES_CATEGORIE_COURTS[s.categorie]} · {LIBELLES_ZONE[s.zone]} · {taux(s.taux_eur_hl)} · du {formatJour(s.date_debut)}
                  {s.date_fin ? ` au ${formatJour(s.date_fin)}` : ""}
                </span>
                {s.revoked_at ? (
                  <span className="badge-neutral">révoqué le {formatJour(s.revoked_at)}</span>
                ) : (
                  modifiable && (
                    <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => void revoquer(s.id)}>
                      Révoquer
                    </button>
                  )
                )}
              </div>
              <p className="text-navy/70">Motif : {s.motif}</p>
              {s.created_at && (
                <p className="text-xs text-navy/55">
                  Ajouté le {formatJour(s.created_at)}
                  {s.auteur ? ` par ${s.auteur}` : ""}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {modifiable &&
        (ouvert ? (
          <form onSubmit={ajouter} className="grid gap-3 rounded-lg border border-navy/10 p-3 sm:grid-cols-3">
            <label className="block">
              <span className="label">Activité</span>
              <select className="input" value={f.categorie} onChange={(e) => setF({ ...f, categorie: e.target.value as CategorieTicpe })}>
                {CATEGORIES_TICPE.map((c) => (
                  <option key={c} value={c}>
                    {LIBELLES_CATEGORIE_COURTS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Zone</span>
              <select className="input" value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value as ZoneTicpe })}>
                {ZONES_TICPE.map((z) => (
                  <option key={z} value={z}>
                    {LIBELLES_ZONE[z]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Taux (€/hl)</span>
              <input className="input" inputMode="decimal" required value={f.taux} onChange={(e) => setF({ ...f, taux: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Du</span>
              <input className="input" type="date" required value={f.date_debut} onChange={(e) => setF({ ...f, date_debut: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Au (facultatif)</span>
              <input className="input" type="date" value={f.date_fin} onChange={(e) => setF({ ...f, date_fin: e.target.value })} />
            </label>
            <label className="block sm:col-span-3">
              <span className="label">Motif (obligatoire, ex. « taux communiqué par notre expert-comptable »)</span>
              <input className="input" required minLength={3} maxLength={500} value={f.motif} onChange={(e) => setF({ ...f, motif: e.target.value })} />
            </label>
            <div className="flex gap-2 sm:col-span-3">
              <button type="submit" className="btn-primary !px-3 !py-1.5 text-sm" disabled={busy}>
                {busy ? "Enregistrement…" : "Ajouter ce taux"}
              </button>
              <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => setOuvert(false)}>
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn-secondary self-start !px-3 !py-1.5 text-sm" onClick={() => setOuvert(true)}>
            Ajouter un taux particulier
          </button>
        ))}
    </div>
  );
}
