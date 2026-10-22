"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BandeauRefus } from "@/components/acces/BandeauRefus";
import { BadgeEligibilite } from "@/components/ticpe/BadgeEligibilite";
import { fetchGodac, type Refus } from "@/lib/http/fetch-godac";
import { LIBELLES_CATEGORIE_COURTS, formatJour } from "@/lib/ticpe/bareme";
import type { PropositionVehicule } from "@/lib/ticpe/carte-grise";
import type { ResultatEligibilite } from "@/lib/ticpe/eligibilite";

export interface InfosTicpeVehicule {
  ticpe_categorie: string | null;
  pays_immatriculation: string | null;
  ticpe_location_demandeur: string | null;
  flotte_entree_le: string | null;
  flotte_sortie_le: string | null;
  cg_genre: string | null;
  cg_energie: string | null;
  cg_premiere_immat: string | null;
  cg_confirmee_le: string | null;
}

const CLASSE_GRAVITE = { exclu: "text-orange-ink", a_verifier: "text-gold-ink", info: "text-navy/65" } as const;

/**
 * Bloc TICPE de la fiche véhicule : statut ✅ / ⚠️ / ❌ et ses raisons,
 * période d'éligibilité, réglages du véhicule et lecture de la carte
 * grise (proposition à confirmer).
 */
export function VehiculeTicpePanel({
  vehicleId,
  eligibilite,
  infos,
  loue,
  categorieDefaut,
  aCarteGrise,
  modifiable,
  colonnesDisponibles,
}: {
  vehicleId: string;
  eligibilite: ResultatEligibilite;
  infos: InfosTicpeVehicule;
  loue: boolean;
  categorieDefaut: string;
  aCarteGrise: boolean;
  modifiable: boolean;
  colonnesDisponibles: boolean;
}) {
  const router = useRouter();
  const [edition, setEdition] = useState(false);
  const [f, setF] = useState({
    ticpe_categorie: infos.ticpe_categorie ?? "",
    pays_immatriculation: infos.pays_immatriculation ?? "",
    ticpe_location_demandeur: infos.ticpe_location_demandeur ?? "",
    flotte_entree_le: infos.flotte_entree_le ?? "",
    flotte_sortie_le: infos.flotte_sortie_le ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [refus, setRefus] = useState<Refus | null>(null);
  const [lecture, setLecture] = useState<{ proposition: PropositionVehicule; differences: string[] } | null>(null);
  const [cg, setCg] = useState<PropositionVehicule | null>(null);

  async function enregistrer(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/vehicles/${vehicleId}/ticpe`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticpe_categorie: f.ticpe_categorie || null,
        pays_immatriculation: f.pays_immatriculation.trim() || null,
        ticpe_location_demandeur: f.ticpe_location_demandeur || null,
        flotte_entree_le: f.flotte_entree_le || null,
        flotte_sortie_le: f.flotte_sortie_le || null,
      }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setEdition(false);
    router.refresh();
  }

  async function lireCarteGrise() {
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac<{ proposition: PropositionVehicule; differences: string[] }>(`/api/vehicles/${vehicleId}/carte-grise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "lire" }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setLecture(r.data);
    setCg(r.data.proposition);
  }

  function saisieManuelle() {
    const vide: PropositionVehicule = {
      registration: null,
      type: null,
      ptac_kg: null,
      fuel_type: null,
      cg_genre: infos.cg_genre,
      cg_energie: infos.cg_energie,
      cg_premiere_immat: infos.cg_premiere_immat,
      brand: null,
    };
    setLecture({ proposition: vide, differences: [] });
    setCg(vide);
  }

  async function confirmerCarteGrise(ev: React.FormEvent) {
    ev.preventDefault();
    if (!cg) return;
    setBusy(true);
    setRefus(null);
    const r = await fetchGodac(`/api/vehicles/${vehicleId}/carte-grise`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirmer",
        type: cg.type,
        ptac_kg: cg.ptac_kg,
        fuel_type: cg.fuel_type,
        cg_genre: cg.cg_genre,
        cg_energie: cg.cg_energie,
        cg_premiere_immat: cg.cg_premiere_immat,
      }),
    });
    setBusy(false);
    if (!r.ok) return setRefus(r.refus);
    setLecture(null);
    setCg(null);
    router.refresh();
  }

  const { periode } = eligibilite;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeEligibilite statut={eligibilite.statut} />
        {eligibilite.categorie && <span className="text-xs text-navy/60">{LIBELLES_CATEGORIE_COURTS[eligibilite.categorie]}</span>}
      </div>
      {eligibilite.raisons.length > 0 && (
        <ul className="flex flex-col gap-1">
          {eligibilite.raisons.map((r) => (
            <li key={r.code} className={CLASSE_GRAVITE[r.gravite]}>
              {r.libelle}
            </li>
          ))}
        </ul>
      )}
      {(periode.debut || periode.fin) && (
        <p className="text-navy/70">
          Compté {periode.debut ? `à partir du ${formatJour(periode.debut)}` : ""}
          {periode.debut && periode.fin ? " et " : ""}
          {periode.fin ? `jusqu'au ${formatJour(periode.fin)}` : ""}.
        </p>
      )}
      {infos.cg_confirmee_le && (
        <p className="text-xs text-navy/60">
          Carte grise confirmée le {formatJour(infos.cg_confirmee_le)}
          {infos.cg_genre ? ` · genre ${infos.cg_genre}` : ""}
          {infos.cg_energie ? ` · énergie ${infos.cg_energie}` : ""}
          {infos.cg_premiere_immat ? ` · 1re immatriculation ${formatJour(infos.cg_premiere_immat)}` : ""}
        </p>
      )}
      <BandeauRefus refus={refus} onFermer={() => setRefus(null)} />

      {modifiable && !colonnesDisponibles && <p className="text-xs text-navy/55">Réglages du véhicule disponibles après la prochaine mise à jour de la base.</p>}

      {modifiable && colonnesDisponibles && !edition && !lecture && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => setEdition(true)}>
            Régler la TICPE du véhicule
          </button>
          {aCarteGrise ? (
            <button type="button" className="btn-secondary !px-3 !py-1.5 text-xs" onClick={() => void lireCarteGrise()} disabled={busy}>
              {busy ? "Lecture…" : "Lire la carte grise"}
            </button>
          ) : (
            <span className="text-xs text-navy/55">Ajoutez la carte grise dans les documents pour la lire automatiquement.</span>
          )}
          <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={saisieManuelle}>
            Saisir la carte grise
          </button>
        </div>
      )}

      {edition && (
        <form onSubmit={enregistrer} className="grid gap-2 rounded-lg border border-navy/10 p-3">
          <label className="block">
            <span className="label">Activité TICPE</span>
            <select className="input" value={f.ticpe_categorie} onChange={(e) => setF({ ...f, ticpe_categorie: e.target.value })}>
              <option value="">Par défaut de l&apos;entreprise ({categorieDefaut})</option>
              <option value="trm">Marchandises</option>
              <option value="trv">Voyageurs (autocar)</option>
              <option value="taxi">Taxi</option>
              <option value="exclu">Écarter ce véhicule de la TICPE</option>
            </select>
          </label>
          <label className="block">
            <span className="label">Pays d&apos;immatriculation (vide = France)</span>
            <input className="input" maxLength={2} placeholder="FR" value={f.pays_immatriculation} onChange={(e) => setF({ ...f, pays_immatriculation: e.target.value.toUpperCase() })} />
          </label>
          {loue && (
            <label className="block">
              <span className="label">Véhicule loué : le remboursement est demandé par</span>
              <select className="input" value={f.ticpe_location_demandeur} onChange={(e) => setF({ ...f, ticpe_location_demandeur: e.target.value })}>
                <option value="">Réglage de l&apos;entreprise (à confirmer)</option>
                <option value="nous">nous</option>
                <option value="loueur">le loueur</option>
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">Entrée dans la flotte</span>
              <input className="input" type="date" value={f.flotte_entree_le} onChange={(e) => setF({ ...f, flotte_entree_le: e.target.value })} />
            </label>
            <label className="block">
              <span className="label">Sortie de la flotte</span>
              <input className="input" type="date" value={f.flotte_sortie_le} onChange={(e) => setF({ ...f, flotte_sortie_le: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button type="button" className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => setEdition(false)}>
              Annuler
            </button>
          </div>
        </form>
      )}

      {lecture && cg && (
        <form onSubmit={confirmerCarteGrise} className="grid gap-2 rounded-lg border border-gold/40 bg-gold/5 p-3">
          <p className="text-xs text-navy/70">Vérifiez chaque case avec la carte grise sous les yeux, corrigez si besoin, puis confirmez.</p>
          {lecture.differences.length > 0 && (
            <ul className="text-xs text-orange-ink">
              {lecture.differences.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="label">F.2 — PTAC (kg)</span>
              <input className="input" type="number" min={1} value={cg.ptac_kg ?? ""} onChange={(e) => setCg({ ...cg, ptac_kg: e.target.value ? Number(e.target.value) : null })} />
            </label>
            <label className="block">
              <span className="label">J.1 — Genre</span>
              <input className="input" value={cg.cg_genre ?? ""} onChange={(e) => setCg({ ...cg, cg_genre: e.target.value.toUpperCase() || null })} />
            </label>
            <label className="block">
              <span className="label">P.3 — Énergie (code)</span>
              <input className="input" maxLength={4} value={cg.cg_energie ?? ""} onChange={(e) => setCg({ ...cg, cg_energie: e.target.value.toUpperCase() || null })} />
            </label>
            <label className="block">
              <span className="label">B — 1re immatriculation</span>
              <input className="input" type="date" value={cg.cg_premiere_immat ?? ""} onChange={(e) => setCg({ ...cg, cg_premiere_immat: e.target.value || null })} />
            </label>
            <label className="block">
              <span className="label">Type GODAC</span>
              <select className="input" value={cg.type ?? ""} onChange={(e) => setCg({ ...cg, type: (e.target.value || null) as PropositionVehicule["type"] })}>
                <option value="">inchangé</option>
                <option value="VL">VL</option>
                <option value="PL">PL</option>
                <option value="SPL">SPL</option>
              </select>
            </label>
            <label className="block">
              <span className="label">Motorisation (fiche)</span>
              <input className="input" value={cg.fuel_type ?? ""} onChange={(e) => setCg({ ...cg, fuel_type: e.target.value || null })} />
            </label>
          </div>
          {cg.registration && <p className="text-xs text-navy/60">A — Immatriculation lue : {cg.registration}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary !px-3 !py-1.5 text-xs" disabled={busy}>
              {busy ? "Enregistrement…" : "Confirmer ces informations"}
            </button>
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 text-xs"
              onClick={() => {
                setLecture(null);
                setCg(null);
              }}
            >
              Annuler
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
