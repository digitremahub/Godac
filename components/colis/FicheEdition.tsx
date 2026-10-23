"use client";

import { useState } from "react";
import { AdresseInput } from "@/components/colis/AdresseInput";
import { api, type Stop } from "@/components/colis/commun";
import { ChoixTypeArret } from "@/components/colis/Ramasse";
import { NOM_RELAIS_MAX } from "@/lib/colis/relais";
import { lirePoids } from "@/lib/colis/poids";
import { networkErrorMessage } from "@/lib/utils/network-error";
import type { TypeArret } from "@/lib/colis/livraison";

const typeDe = (s: Stop): TypeArret => (s.kind === "ramasse" || s.kind === "point_relais" ? s.kind : "livraison");

/**
 * Modification de la fiche complète d'un arrêt (erreur de saisie à la base) :
 * type, adresse (re-localisée), destinataire, téléphone, colis, poids, relais
 * et consignes. Seuls les champs changés partent vers PATCH
 * /api/colis/arrets/[id] (journalisé ; refusé si la tournée est clôturée).
 */
export function FicheEdition({
  stop,
  biais,
  onFermer,
  onEnregistre,
}: {
  stop: Stop;
  biais: { lat: number; lng: number } | null;
  onFermer: () => void;
  onEnregistre: (texte: string) => Promise<void>;
}) {
  const [type, setType] = useState<TypeArret>(typeDe(stop));
  const [adresse, setAdresse] = useState(stop.address);
  const [destinataire, setDestinataire] = useState(stop.recipient ?? "");
  const [telephone, setTelephone] = useState(stop.phone ?? "");
  const [relais, setRelais] = useState(stop.relay_name ?? "");
  const [colis, setColis] = useState(String(stop.parcel_count));
  const [poids, setPoids] = useState(stop.weight_kg != null && stop.weight_kg !== "" ? String(stop.weight_kg).replace(".", ",") : "");
  const [notes, setNotes] = useState(stop.notes ?? "");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function enregistrer() {
    const corps: Record<string, unknown> = {};
    if (adresse.trim().length < 5) return setErreur("Saisissez une adresse (5 caractères au moins).");
    if (adresse.trim() !== stop.address.trim()) corps.adresse = adresse.trim();
    if (type !== typeDe(stop)) corps.type = type;
    if (destinataire.trim() !== (stop.recipient ?? "")) corps.destinataire = destinataire.trim() || null;
    if (telephone.trim() !== (stop.phone ?? "")) corps.telephone = telephone.trim() || null;
    if (type === "point_relais" && relais.trim() !== (stop.relay_name ?? "")) corps.relais = relais.trim() || null;
    const n = Number(colis);
    if (!Number.isInteger(n) || n < 1 || n > 500) return setErreur("Nombre de colis : de 1 à 500.");
    if (n !== stop.parcel_count) corps.parcel_count = n;
    const poidsActuel = stop.weight_kg != null && stop.weight_kg !== "" ? Number(stop.weight_kg) : null;
    const poidsSaisi = poids.trim() ? lirePoids(poids) : null;
    if (poids.trim() && poidsSaisi === null) return setErreur("Poids illisible (exemple : 2,5 kg).");
    if (poidsSaisi !== poidsActuel) corps.poids = poidsSaisi;
    if (notes.trim() !== (stop.notes ?? "")) corps.notes = notes.trim() || null;
    if (Object.keys(corps).length === 0) return onFermer();
    setEnvoi(true);
    setErreur(null);
    try {
      await api(`/api/colis/arrets/${stop.id}`, { method: "PATCH", body: JSON.stringify(corps) });
      await onEnregistre(corps.adresse ? "Fiche modifiée : adresse localisée de nouveau." : "Fiche modifiée.");
    } catch (e) {
      setErreur(networkErrorMessage(e));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <ChoixTypeArret value={type} onChange={setType} />
      <AdresseInput value={adresse} biais={biais} onChange={setAdresse} onChoisir={(sug) => setAdresse(sug.adresse)} />
      <div className="grid grid-cols-2 gap-2">
        <input className="input" value={destinataire} onChange={(e) => setDestinataire(e.target.value)} placeholder="Destinataire" maxLength={120} aria-label="Destinataire" />
        <input className="input" type="tel" inputMode="tel" value={telephone} onChange={(e) => setTelephone(e.target.value)} placeholder="Téléphone" aria-label="Téléphone" />
      </div>
      {type === "point_relais" && <input className="input" value={relais} onChange={(e) => setRelais(e.target.value)} placeholder="Nom du relais" maxLength={NOM_RELAIS_MAX * 2} aria-label="Nom du point relais" />}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-semibold text-navy/60">
          Colis
          <input className="input mt-1" inputMode="numeric" value={colis} onChange={(e) => setColis(e.target.value.replace(/\D/g, ""))} aria-label="Nombre de colis" />
        </label>
        <label className="text-xs font-semibold text-navy/60">
          Poids (kg)
          <input className="input mt-1" inputMode="decimal" value={poids} onChange={(e) => setPoids(e.target.value)} placeholder="inconnu" aria-label="Poids en kg" />
        </label>
      </div>
      <textarea className="input min-h-[72px]" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Consignes (code, étage…)" maxLength={500} aria-label="Consignes" />
      {erreur && (
        <p role="alert" className="text-sm font-semibold text-orange-ink">
          {erreur}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary min-h-[48px] justify-center" onClick={onFermer} disabled={envoi}>
          Annuler
        </button>
        <button type="button" className="btn-primary min-h-[48px] justify-center" onClick={enregistrer} disabled={envoi}>
          {envoi ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </div>
  );
}
