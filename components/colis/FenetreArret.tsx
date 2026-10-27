"use client";

import { useState } from "react";
import { IconCheck, IconMapPin, IconMessage, IconNavigation, IconPhone, IconX } from "@/components/layout/icons";
import { BadgeArret } from "@/components/colis/Ramasse";
import { BadgeHoraires, type useHoraires } from "@/components/colis/HorairesSheet";
import { CasesContact } from "@/components/colis/ContactsArret";
import { FicheEdition } from "@/components/colis/FicheEdition";
import { gmaps, waze, SMS_ARRIVEE, type Stop } from "@/components/colis/commun";
import type { ChampContact } from "@/lib/colis/contacts";
import { libelleMotif } from "@/lib/colis/cloture";
import { estPointRelais, estRamasse, libelleStatut } from "@/lib/colis/livraison";
import { libelleLivre } from "@/lib/colis/mode-simple";
import { formatPoids } from "@/lib/colis/poids";
import { lienSms, lienTel } from "@/lib/colis/telephone";

type Horaires = ReturnType<typeof useHoraires>;

/** Heure locale « 14:05 » d'un horodatage ISO ; null si absent ou illisible. */
function heureDe(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
}

export interface FenetreArretProps {
  stop: Stop;
  /** Rang de l'arrêt dans la tournée (1 = premier). */
  numero: number;
  modeSimple: boolean;
  /** « Passer à plus tard » n'a de sens que s'il reste un autre arrêt à faire. */
  peutPasser: boolean;
  /** Tournée clôturée : consultation seule (appel, horaires, navigation externe). */
  lecture: boolean;
  horaires: Horaires;
  /** Position de départ pour localiser une adresse modifiée (fiche complète). */
  biais: { lat: number; lng: number } | null;
  onFermer: () => void;
  onAppel: (s: Stop) => void;
  onTelephone: (s: Stop) => void;
  onHoraires: (s: Stop) => void;
  onLivre: (s: Stop) => void;
  onNonLivre: (s: Stop) => void;
  onRetirer: (s: Stop) => void;
  onPasser: (s: Stop) => void;
  onContact: (s: Stop, champ: ChampContact, valeur: boolean) => void;
  /** Correction rapide de l'adresse (GO) ; absent : « Modifier la fiche » couvre l'adresse. */
  onCorriger?: (s: Stop) => void;
  /** Fiche complète enregistrée : l'écran recharge la tournée et affiche le message. */
  onModifie: (texte: string) => Promise<void>;
}

/**
 * UNE seule fenêtre d'arrêt, la même dans GO Navigation (⋯ Plus, appui long,
 * tap sur la carte, ✏️) et dans la liste de l'app chauffeur (« Ouvrir la fiche »).
 * Feuille basse mobile, de haut en bas : identité de l'arrêt, actions
 * principales en 1 tap, infos de la fiche, actions secondaires. Pas de seconde
 * fenêtre « fiche » : la modification complète remplace seulement le contenu.
 */
export function FenetreArret(p: FenetreArretProps) {
  const { stop: s, lecture, modeSimple } = p;
  const [edition, setEdition] = useState(false);
  const agir = (f: (s: Stop) => void) => () => {
    p.onFermer();
    f(s);
  };
  const type = estRamasse(s) ? "Ramasse" : estPointRelais(s) ? `Point relais${s.relay_name ? ` · ${s.relay_name}` : ""}` : "Livraison";
  const heureFaite = heureDe(s.done_at);
  const heureContact = heureDe(s.contact_at);
  const motif = s.status === "failed" ? libelleMotif(s.failure_reason) : null;
  const action = "flex min-h-[48px] items-center rounded-xl bg-navy/[0.05] px-4 text-left text-sm font-semibold text-navy";
  const lien = "btn-secondary min-h-[48px] justify-center !px-2 !py-2 text-sm";
  const titre = "text-xs font-semibold uppercase tracking-wide text-navy/55";

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center bg-marine/60 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fenetre-arret-titre" data-fenetre-arret="" onClick={p.onFermer}>
      <section className="flex max-h-[85dvh] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-t-3xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-pop sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        {/* 1. Identité de l'arrêt */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-navy/60">
              <BadgeArret stop={s} />
              <span>
                Arrêt {p.numero} · {type}
              </span>
            </p>
            <h2 id="fenetre-arret-titre" className="mt-1 break-words font-display text-lg font-bold leading-snug">
              {s.address}
            </h2>
            {s.recipient && <p className="break-words text-sm text-navy/75">{s.recipient}</p>}
            <p className="text-xs text-navy/65">
              {s.parcel_count} colis{formatPoids(s.weight_kg) ? ` · ${formatPoids(s.weight_kg)}` : ""}
              {s.status !== "pending" ? ` · ${libelleStatut(s)}` : ""}
            </p>
            <BadgeHoraires stop={s} fenetres={p.horaires.fenetres.get(s.id) ?? null} passage={p.horaires.passages.get(s.id)} />
          </div>
          <button type="button" className="btn-ghost min-h-[44px] min-w-[44px] !px-2" onClick={p.onFermer} aria-label="Fermer">
            ✕
          </button>
        </div>

        {edition ? (
          <FicheEdition
            stop={s}
            biais={p.biais}
            onFermer={() => setEdition(false)}
            onEnregistre={async (texte) => {
              setEdition(false);
              p.onFermer();
              await p.onModifie(texte);
            }}
          />
        ) : (
          <>
            {/* 2. Actions principales, 1 tap */}
            {!lecture && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn-primary min-h-[48px] justify-center" onClick={agir(p.onLivre)}>
                  <IconCheck className="h-5 w-5" /> {libelleLivre(modeSimple, s)}
                </button>
                <button type="button" className="btn-secondary min-h-[48px] justify-center text-orange-ink" onClick={agir(p.onNonLivre)}>
                  <IconX className="h-5 w-5" /> Non livré
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {s.phone ? (
                <a href={lienTel(s.phone)} onClick={() => { p.onFermer(); p.onAppel(s); }} className={`${lien} text-teal-ink`}>
                  <IconPhone className="h-4 w-4" /> Appeler
                </a>
              ) : (
                !lecture && (
                  <button type="button" className={lien} onClick={agir(p.onTelephone)}>
                    <IconPhone className="h-4 w-4" /> Ajouter le numéro
                  </button>
                )
              )}
              {s.phone && (
                <a href={lienSms(s.phone, SMS_ARRIVEE)} className={lien}>
                  <IconMessage className="h-4 w-4" /> SMS « j&apos;arrive »
                </a>
              )}
              <a href={waze(s)} target="_blank" rel="noreferrer" className={lien}>
                <IconNavigation className="h-4 w-4" /> Waze
              </a>
              <a href={gmaps(s)} target="_blank" rel="noreferrer" className={lien}>
                <IconMapPin className="h-4 w-4" /> Google Maps
              </a>
            </div>

            {/* 3. Infos de la fiche */}
            <div className="flex flex-col gap-2 border-t border-navy/10 pt-3">
              <p className={titre}>Détails</p>
              {s.phone && <p className="text-sm">{s.phone}</p>}
              {s.business_name && <p className="text-sm text-navy/75">{s.business_name}</p>}
              {s.notes && <p className="rounded-lg bg-navy/5 p-3 text-sm">{s.notes}</p>}
              {(s.packages_picked_up != null || s.packages_delivered != null) && (
                <p className="text-sm text-navy/65">
                  {s.packages_picked_up != null ? `${estPointRelais(s) ? "Retours repris" : "Récupérés"} : ${s.packages_picked_up}` : ""}
                  {s.packages_picked_up != null && s.packages_delivered != null ? " · " : ""}
                  {s.packages_delivered != null ? `Déposés : ${s.packages_delivered}` : ""}
                </p>
              )}
              {!lecture && <CasesContact valeur={s} onChange={(champ, v) => p.onContact(s, champ, v)} />}
              <button type="button" className={action} onClick={agir(p.onHoraires)}>
                🕘 Horaires
              </button>
              {(s.status !== "pending" || heureContact) && (
                <div className="rounded-lg bg-navy/5 p-3 text-sm">
                  <p className={titre}>Historique</p>
                  {s.status !== "pending" && (
                    <p>
                      {libelleStatut(s)}
                      {heureFaite ? ` à ${heureFaite}` : ""}
                      {motif ? ` · ${motif}` : ""}
                    </p>
                  )}
                  {heureContact && <p>Client contacté à {heureContact}</p>}
                </div>
              )}
            </div>

            {/* 4. Actions secondaires */}
            {!lecture && (
              <div className="flex flex-col gap-2 border-t border-navy/10 pt-3">
                {p.onCorriger && (
                  <button type="button" className={action} onClick={agir(p.onCorriger)}>
                    ✏️ Modifier l&apos;adresse
                  </button>
                )}
                <button type="button" className={action} onClick={() => setEdition(true)}>
                  ✏️ Modifier la fiche
                </button>
                {p.peutPasser && s.status === "pending" && (
                  <button type="button" className={action} onClick={agir(p.onPasser)}>
                    Passer à plus tard
                  </button>
                )}
                <button type="button" className={`${action} text-orange-ink`} onClick={agir(p.onRetirer)}>
                  Retirer cette adresse
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
