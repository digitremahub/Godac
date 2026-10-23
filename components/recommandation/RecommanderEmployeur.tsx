"use client";

import { useState } from "react";
import { IconX } from "@/components/layout/icons";
import { fetchGodac } from "@/lib/http/fetch-godac";
import { TEXTE_CONSENTEMENT } from "@/lib/recommandation/consentement";

/**
 * « Recommander GODAC à mon employeur » : feuille modale (mobile d'abord)
 * ouverte depuis l'appli livreur des comptes GO Navigation, et appelable
 * depuis un futur écran de limite (prop `onFermer`). Rien n'est envoyé à
 * l'employeur : la recommandation arrive à l'équipe GODAC, qui le contacte
 * seulement parce que le chauffeur a coché son accord (texte conservé).
 */
export function RecommanderEmployeur({ onFermer }: { onFermer: () => void }) {
  const [entreprise, setEntreprise] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [message, setMessage] = useState("");
  const [accord, setAccord] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoye, setEnvoye] = useState(false);

  async function envoyer(e: React.FormEvent) {
    e.preventDefault();
    if (!accord || envoi) return;
    setEnvoi(true);
    setErreur(null);
    const r = await fetchGodac("/api/recommandation-employeur", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyName: entreprise, contactName: contact, contactEmail: email, contactPhone: telephone, message, consent: accord }),
    });
    setEnvoi(false);
    if (!r.ok) return setErreur(r.refus.message);
    setEnvoye(true);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="reco-titre">
      <div className="flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-3xl bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="reco-titre" className="font-display text-lg font-bold leading-snug">
            Recommander GODAC à mon employeur
          </h2>
          <button type="button" className="btn-ghost !min-h-[44px] !min-w-[44px] !px-2 !py-1" onClick={onFermer} aria-label="Fermer">
            <IconX className="h-5 w-5" />
          </button>
        </div>

        {envoye ? (
          <div className="flex flex-col gap-4" role="status">
            <p className="rounded-xl bg-navy/[0.05] px-4 py-3 text-sm">Merci ! Votre recommandation est transmise à l&apos;équipe GODAC. Nous contacterons votre employeur en mentionnant votre recommandation.</p>
            <button type="button" className="btn-primary min-h-[44px]" onClick={onFermer}>
              Fermer
            </button>
          </div>
        ) : (
          <form onSubmit={envoyer} className="flex flex-col gap-3">
            <p className="text-sm text-navy/70">Indiquez l&apos;entreprise pour laquelle vous travaillez et comment la joindre. Rien n&apos;est envoyé à votre employeur sans votre accord ci-dessous.</p>
            <div>
              <label className="label" htmlFor="reco-entreprise">
                Nom de l&apos;entreprise
              </label>
              <input id="reco-entreprise" className="input min-h-[44px]" required minLength={2} maxLength={120} value={entreprise} onChange={(e) => setEntreprise(e.target.value)} autoComplete="organization" />
            </div>
            <div>
              <label className="label" htmlFor="reco-contact">
                Personne à contacter (facultatif)
              </label>
              <input id="reco-contact" className="input min-h-[44px]" maxLength={120} value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Dirigeant, responsable d'exploitation…" />
            </div>
            <div>
              <label className="label" htmlFor="reco-email">
                E-mail de l&apos;entreprise
              </label>
              <input id="reco-email" type="email" inputMode="email" className="input min-h-[44px]" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="reco-tel">
                Téléphone de l&apos;entreprise
              </label>
              <input id="reco-tel" type="tel" inputMode="tel" className="input min-h-[44px]" maxLength={30} value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              <p className="mt-1 text-xs text-navy/60">E-mail ou téléphone : au moins un des deux.</p>
            </div>
            <div>
              <label className="label" htmlFor="reco-message">
                Message (facultatif)
              </label>
              <textarea id="reco-message" className="input min-h-[88px]" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
              <p className="mt-1 text-right text-xs tabular-nums text-navy/60">{message.length}/500</p>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-navy/[0.14] p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal" checked={accord} onChange={(e) => setAccord(e.target.checked)} />
              <span>{TEXTE_CONSENTEMENT}</span>
            </label>

            {erreur && (
              <p role="alert" className="rounded-xl bg-orange/[0.12] px-3 py-2 text-sm font-semibold text-orange-ink">
                {erreur}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary min-h-[44px]" onClick={onFermer}>
                Annuler
              </button>
              <button type="submit" className="btn-primary min-h-[44px]" disabled={!accord || envoi}>
                {envoi ? "Envoi…" : "Envoyer ma recommandation"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
