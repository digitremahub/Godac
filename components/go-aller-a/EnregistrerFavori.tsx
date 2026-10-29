"use client";

import { useState } from "react";
import { LIBELLE_MAX, type LieuSaisie, type TypeLieuFixe } from "@/lib/go-lieux/lieux";
import { MESSAGE_SAISIE_BLOQUEE } from "@/lib/go-lieux/saisie";

/** « Ajouter aux favoris » : Domicile, Travail ou un favori nommé (le nom ne se saisit qu'à l'arrêt). */
export function EnregistrerFavori({ lieu, mouvement, onEnregistrer, onFermer }: { lieu: LieuSaisie; mouvement: boolean; onEnregistrer: (lieu: LieuSaisie, type: TypeLieuFixe | null) => Promise<boolean>; onFermer: () => void }) {
  const [nom, setNom] = useState(lieu.libelle);
  const [nomme, setNomme] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  async function enregistrer(type: TypeLieuFixe | null) {
    setEnvoi(true);
    const ok = await onEnregistrer({ ...lieu, libelle: nom.trim() || lieu.libelle }, type);
    setEnvoi(false);
    if (ok) onFermer();
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-navy/10 bg-surface p-3" role="group" aria-label="Enregistrer ce lieu en favori">
      <p className="text-sm font-semibold">Enregistrer comme…</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-secondary min-h-[48px] justify-center" disabled={envoi} onClick={() => void enregistrer("domicile")}>
          Domicile
        </button>
        <button type="button" className="btn-secondary min-h-[48px] justify-center" disabled={envoi} onClick={() => void enregistrer("travail")}>
          Travail
        </button>
      </div>
      {nomme ? (
        <>
          {mouvement ? (
            <p role="alert" className="text-sm font-semibold text-orange-ink">{MESSAGE_SAISIE_BLOQUEE}</p>
          ) : (
            <input className="input" value={nom} maxLength={LIBELLE_MAX} onChange={(e) => setNom(e.target.value)} aria-label="Nom du favori" autoFocus />
          )}
          <button type="button" className="btn-primary min-h-[48px] justify-center" disabled={envoi || mouvement || !nom.trim()} onClick={() => void enregistrer(null)}>
            Enregistrer le favori
          </button>
        </>
      ) : (
        <button type="button" className="btn-secondary min-h-[48px] justify-center" onClick={() => setNomme(true)}>
          Autre favori (avec un nom)…
        </button>
      )}
      <button type="button" className="btn-ghost min-h-[44px] justify-center text-sm" onClick={onFermer}>
        Annuler
      </button>
    </div>
  );
}
