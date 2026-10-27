"use client";

import { useEffect, useState } from "react";
import { IconCamera } from "@/components/layout/icons";
import { verifierFichierTicket } from "@/lib/fuel/justificatif";

/**
 * Photo du ticket facultative, proposée sur « Saisir le ticket à la main » :
 * appareil photo ou galerie. Le fichier est seulement choisi ici ; le wizard
 * l'envoie une fois le plein enregistré (lib/fuel/ticket-client.ts), ce qui
 * pose le justificatif dès la saisie. Zones de toucher de 44 px au moins.
 */
export function ChampPhotoTicket({ fichier, onChange }: { fichier: File | null; onChange: (fichier: File | null) => void }) {
  const [apercu, setApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!fichier) return setApercu(null);
    const url = URL.createObjectURL(fichier);
    setApercu(url);
    return () => URL.revokeObjectURL(url);
  }, [fichier]);

  function choisir(f: File | undefined) {
    if (!f) return;
    const invalide = verifierFichierTicket({ mime: f.type, taille: f.size });
    setErreur(invalide);
    if (!invalide) onChange(f);
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="label">Photo du ticket (facultative)</p>
      <p className="text-xs text-navy/60">Elle sert de justificatif pour la comptabilité et la TICPE. Vous pourrez aussi la joindre plus tard depuis la liste des pleins.</p>
      {apercu && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={apercu} alt="Ticket choisi" width={160} height={112} className="h-28 w-40 rounded-lg border border-navy/10 object-cover" />
      )}
      <div className="flex flex-wrap gap-2">
        <label className="btn-secondary min-h-[44px] flex-1 cursor-pointer justify-center text-center text-sm">
          <IconCamera className="inline-block h-4 w-4 shrink-0 align-[-0.2em]" /> Appareil photo
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => choisir(e.target.files?.[0])} />
        </label>
        <label className="btn-secondary min-h-[44px] flex-1 cursor-pointer justify-center text-center text-sm">
          Galerie
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => choisir(e.target.files?.[0])} />
        </label>
        {fichier && (
          <button type="button" className="btn-ghost min-h-[44px] text-sm" onClick={() => onChange(null)}>
            Retirer
          </button>
        )}
      </div>
      {erreur && (
        <p role="alert" className="text-xs text-orange-ink">
          {erreur}
        </p>
      )}
    </div>
  );
}
