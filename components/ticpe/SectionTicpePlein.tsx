"use client";

import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { confirmer } from "@/lib/ui/confirmation";
import type { TicpeDuPlein } from "@/lib/fuel/detail-plein";
import { MENTION_A_CONFIRMER } from "@/lib/ticpe/reglages";

const euros = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
const litres = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} L`;
const ORIGINE_ZONE: Record<string, string> = { plein: "zone saisie sur ce plein", cuve: "zone de la cuve", defaut: "zone par défaut de l'entreprise" };

/** Bloc « Remboursement TICPE » de la fiche d'un plein. */
/** PATCH d'un plein ; si sa période TICPE est déjà déclarée, demande une confirmation puis renvoie la demande confirmée. */
async function modifierPlein(url: string, corps: Record<string, unknown>) {
  const envoyer = (c: Record<string, unknown>) => fetchGodac(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
  const r = await envoyer(corps);
  if (r.ok || r.refus.statut !== 409 || !r.refus.periodeDeclaree) return r;
  const ok = await confirmer({ titre: "Période déjà déclarée", message: r.refus.message, action: "Modifier quand même" });
  return ok ? envoyer({ ...corps, confirmer_periode_declaree: true }) : r;
}

export function SectionTicpePlein({ entryId, ticpe, onModifie }: { entryId: string; ticpe: TicpeDuPlein; onModifie: () => Promise<void> }) {
  const [edition, setEdition] = useState(false);
  const [type, setType] = useState<"releve_carte" | "facture" | "">(ticpe.justificatif.type === "releve_carte" || ticpe.justificatif.type === "facture" ? ticpe.justificatif.type : "");
  const [ref, setRef] = useState("");
  const [editionZone, setEditionZone] = useState(false);
  const [zone, setZone] = useState<"" | "metropole" | "corse">(ticpe.zoneSaisie ?? "");
  const [pays, setPays] = useState(ticpe.paysAchat ?? "");
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);

  async function enregistrer(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/fuel-entries/${entryId}/justificatif`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: type || null, ref: ref.trim() || null }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setEdition(false);
    await onModifie();
  }

  async function enregistrerZone(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await modifierPlein(`/api/fuel-entries/${entryId}/zone`, { ticpe_zone: zone || null, pays_achat: pays.trim() ? pays.trim().toUpperCase() : null });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setEditionZone(false);
    await onModifie();
  }

  async function doublon(lever: boolean) {
    setBusy(true);
    setRefus(null);
    const r = await modifierPlein(`/api/fuel-entries/${entryId}/doublon`, { lever });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    await onModifie();
  }

  return (
    <div className="text-sm">
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
      {ticpe.periodeDeclaree && (
        <p className="mb-2 rounded-lg border border-orange-ink/30 bg-surface p-2 text-xs text-orange-ink">
          Ce plein appartient à une période déjà déclarée ({ticpe.periodeDeclaree}). Toute modification change le montant calculé et devra être régularisée ; elle est
          enregistrée au journal avec l&apos;ancienne et la nouvelle valeur.
        </p>
      )}
      {ticpe.statut === "exclu" ? (
        <p className="text-navy/70">Non compté : {ticpe.raison}</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-navy/55">Montant récupérable</dt>
            <dd className="font-semibold text-navy">{ticpe.statut === "taux_manquant" ? <span className="text-orange-ink">taux manquant</span> : euros(ticpe.montant)}</dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Taux</dt>
            <dd>
              {ticpe.taux === null ? "—" : `${ticpe.taux.toLocaleString("fr-FR")} €/hl`}
              {ticpe.origineTaux === "surcharge" && <span className="text-xs text-navy/55"> (taux particulier)</span>}
              {ticpe.tauxAConfirmer && <span className="block text-xs text-navy/55">{MENTION_A_CONFIRMER}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Zone</dt>
            <dd>
              {ticpe.zone ?? "—"}
              {ticpe.origineZone && <span className="block text-xs text-navy/55">{ORIGINE_ZONE[ticpe.origineZone] ?? ""}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-navy/55">Litres retenus</dt>
            <dd>
              {litres(ticpe.litresRetenus)}
              {ticpe.litresHorsPlafond > 0 && <span className="block text-xs text-orange-ink">{litres(ticpe.litresHorsPlafond)} au-delà du plafond</span>}
            </dd>
          </div>
          {ticpe.statut === "taux_manquant" && ticpe.raison && <p className="col-span-full text-xs text-orange-ink">{ticpe.raison}</p>}
        </dl>
      )}
      {ticpe.zoneIncertaine && (
        <p className="mt-2 text-orange-ink">
          La station évoque la Corse{ticpe.zonePropose ? ` (zone proposée : ${ticpe.zonePropose})` : ""}, mais la zone de ce plein n&apos;est pas renseignée : compté en zone par
          défaut. À vérifier et à indiquer ci-dessous.
        </p>
      )}
      {ticpe.paysAchat && ticpe.paysAchat.toUpperCase() !== "FR" && <p className="mt-2 text-navy/70">Pays d&apos;achat : {ticpe.paysAchat.toUpperCase()}.</p>}
      {ticpe.zoneModifiable && !editionZone && (
        <p className="mt-2">
          <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" onClick={() => setEditionZone(true)}>
            Indiquer la zone (Corse / métropole) et le pays d&apos;achat
          </button>
        </p>
      )}
      {editionZone && (
        <form onSubmit={enregistrerZone} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-navy/10 bg-surface p-3">
          <label className="block">
            <span className="label">Zone du plein</span>
            <select className="input" value={zone} onChange={(e) => setZone(e.target.value as typeof zone)}>
              <option value="">Non précisée (cuve ou zone par défaut)</option>
              <option value="metropole">Métropole hors Corse</option>
              <option value="corse">Corse</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Pays d&apos;achat (code à 2 lettres)</span>
            <input className="input w-28" maxLength={2} placeholder="FR" value={pays} onChange={(e) => setPays(e.target.value.toUpperCase())} />
          </label>
          <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEditionZone(false)}>
            Annuler
          </button>
          <p className="w-full text-xs text-navy/55">Un plein acheté hors de France n&apos;est pas compté ({MENTION_A_CONFIRMER}).</p>
        </form>
      )}
      {ticpe.doublonLevable && ticpe.doublon && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-orange-ink">
          Ce plein ressemble à un autre (même véhicule, même jour, litres proches).
          <button type="button" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={() => doublon(true)}>
            Confirmer deux pleins distincts
          </button>
        </p>
      )}
      {ticpe.doublonLevable && !ticpe.doublon && ticpe.doublonLeveLe && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-navy/70">
          Deux pleins distincts confirmés le {new Date(ticpe.doublonLeveLe).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.
          <button type="button" className="btn-ghost !px-2 !py-0.5 text-xs" disabled={busy} onClick={() => doublon(false)}>
            Annuler la confirmation
          </button>
        </p>
      )}
      <p className={`mt-2 ${ticpe.justificatif.present ? "text-navy/70" : "text-orange-ink"}`}>
        Justificatif à conserver : {ticpe.justificatif.libelle}
        {ticpe.justificatifModifiable && !edition && (
          <button type="button" className="btn-ghost ml-2 !px-2 !py-0.5 text-xs" onClick={() => setEdition(true)}>
            {ticpe.justificatif.present ? "Modifier" : "Déclarer un relevé ou une facture"}
          </button>
        )}
      </p>
      {edition && (
        <form onSubmit={enregistrer} className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-navy/10 bg-surface p-3">
          <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />
          <label className="block">
            <span className="label">Justificatif</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              <option value="">Aucun</option>
              <option value="releve_carte">Relevé de carte carburant</option>
              <option value="facture">Facture carburant</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Référence (facultatif)</span>
            <input className="input" maxLength={120} value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEdition(false)}>
            Annuler
          </button>
        </form>
      )}
    </div>
  );
}
