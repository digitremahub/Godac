"use client";

import { IconMessage, IconPhone } from "@/components/layout/icons";
import { CONTACTS, type ChampContact, type ContactsArret } from "@/lib/colis/contacts";

/**
 * Cases « Message envoyé » / « Eu au téléphone » (fiche « Non livré », fiche
 * de l'arrêt) : zones tactiles de 48 px, valables dans tous les modes.
 */
export function CasesContact({ valeur, onChange }: { valeur: ContactsArret; onChange: (champ: ChampContact, v: boolean) => void }) {
  return (
    <fieldset className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      <legend className="sr-only">Contact avec le client</legend>
      {CONTACTS.map((c) => (
        <label key={c.champ} className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-navy/10 px-3 text-sm font-semibold">
          <input type="checkbox" className="h-5 w-5 accent-[#0A0F1E]" checked={valeur[c.champ] === true} onChange={(e) => onChange(c.champ, e.target.checked)} />
          {c.label}
        </label>
      ))}
    </fieldset>
  );
}

/** Bascules compactes en 1 clic (cartes d'arrêt et listes) : l'état s'affiche en plein quand c'est coché. */
export function PastillesContact({ stop, onChange, disabled }: { stop: ContactsArret; onChange: (champ: ChampContact, v: boolean) => void; disabled?: boolean }) {
  return (
    <>
      {CONTACTS.map((c) => {
        const coche = stop[c.champ] === true;
        return (
          <button
            key={c.champ}
            type="button"
            role="switch"
            aria-checked={coche}
            disabled={disabled}
            onClick={() => onChange(c.champ, !coche)}
            className={`inline-flex min-h-[44px] items-center gap-1 rounded-full px-3 text-xs font-semibold ${coche ? "bg-marine text-white" : "bg-navy/[0.05] text-navy"}`}
          >
            {c.champ === "contact_message" ? <IconMessage className="h-4 w-4" /> : <IconPhone className="h-4 w-4" />} {coche ? "✓ " : ""}
            {c.label}
          </button>
        );
      })}
    </>
  );
}
