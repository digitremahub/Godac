"use client";

import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { couleurChauffeur, initiales, type ArretPlanning, type LigneTournee, type RoutePlanning } from "@/lib/planning/affectation";
import type { AffectationPlanning, CongePlanning, ModelePlanning, VehiculePlanning } from "@/lib/planning/semaine";
import type { EntreeAffichee } from "@/components/planning/FenetresPlanning";
import type { FiltreOuverture } from "@/lib/planning/ouverture";

// ---------------------------------------------------------------------------
// Données de l'écran d'affectation (lues par la page serveur).
// ---------------------------------------------------------------------------

export type VueAffectation = "jour" | "semaine" | "mois";

export interface EntreeAffectation extends EntreeAffichee {
  end_at?: string | null;
  /** Fermeture de la tournée (migration 20261105000001) ; `tour_open` est dans AffectationPlanning. */
  closed_at?: string | null;
  closed_by?: string | null;
}

/** Tournée fusionnée du lundi : tournées d'origine et état de la répartition (lib/planning/fusion.ts). */
export interface FusionPlanning {
  tournees: string[];
  total: number;
  aAttribuer: number;
  provisoires: number;
  confirmes: number;
}

export interface DonneesAffectations {
  vue: VueAffectation;
  /** Jours affichés (vue Jour : un seul). */
  jours: string[];
  /** Lundi de la semaine regardée (vue Mois : celui de la première semaine du mois). */
  lundi: string;
  /** « AAAA-MM » regardé (vue Mois). */
  mois: string;
  services: { id: string; name: string }[];
  /** Services affichés (filtre, ou tous ceux de la personne). */
  serviceIds: string[];
  selectedService: string;
  chauffeurs: { id: string; full_name: string }[];
  rattachements: { user_id: string; service_id: string }[];
  vehicules: (VehiculePlanning & { registration: string })[];
  routes: RoutePlanning[];
  modeles: ModelePlanning[];
  affectations: EntreeAffectation[];
  historique: AffectationPlanning[];
  conges: CongePlanning[];
  arrets: ArretPlanning[];
  /** Colis chargés sur la fiche de chaque affectation (vue Jour, Tournée colis active). */
  colis: Record<string, number>;
  /** Fiche colis qui porte chaque affectation : deux affectations sur la même fiche sont « liées ». */
  fiches: Record<string, string>;
  /** Tournées fusionnées (lundi) de la période, par affectation. Vide sans la migration 20261105000001. */
  fusions: Record<string, FusionPlanning>;
  /** Nom de la personne qui a fermé chaque tournée fermée, par affectation. */
  fermeesPar: Record<string, string | null>;
  /** Chauffeurs à prévenir à la prochaine publication (null : inconnu). */
  aPrevenir: number | null;
  peutModifier: boolean;
}

// ---------------------------------------------------------------------------
// Contexte partagé par les vues (évite de tout passer de main en main).
// ---------------------------------------------------------------------------

export interface ContexteAffectations {
  donnees: DonneesAffectations;
  /** Affectations affichées, avec les changements optimistes. */
  affectations: EntreeAffectation[];
  lignes: LigneTournee[];
  parCase: Map<string, EntreeAffectation[]>;
  jours: string[];
  aujourdhui: string;
  petitEcran: boolean;
  /** Glisser-déposer actif (pas sur téléphone, pas en lecture seule). */
  glisser: boolean;
  /** Chauffeur choisi dans la colonne, en attente d'une case (toucher puis choisir). */
  arme: { id: string; full_name: string } | null;
  /** Étirement en cours : cases surlignées. */
  etirement: { cle: string; source: string; jusqua: string } | null;
  occupe: boolean;
  ouvrirCase: (cle: string, date: string) => void;
  ouvrirLigne: (cle: string) => void;
  choisirChauffeur: (c: { id: string; full_name: string } | null) => void;
  commencerEtirement: (cle: string, source: string, driverId: string, e: React.PointerEvent) => void;
  nomChauffeur: (id: string | null) => string;
  /** Le dimanche est-il affiché (il sert, ou demandé, ou téléphone) ? */
  dimancheAffiche: boolean;
  /** Le dimanche sert-il dans la période (affectation ou tournée qui roule ce jour-là) ? */
  dimancheUtilise: boolean;
  basculerDimanche: () => void;
  /** Ouvre la vue Jour de ce jour (garde le service choisi). */
  allerJour: (date: string) => void;
  /** Ouvre « Heure de la tournée » (date : jour précis d'où l'on vient, sinon la période affichée). */
  ouvrirHeure: (cle: string, date: string | null) => void;
  /** Filtre Ouvertes / Fermées / Toutes. */
  filtreOuverture: FiltreOuverture;
  /** Lignes montrées par le filtre (la vue Jour filtre elle-même ses cartes, jour par jour). */
  lignesVisibles: LigneTournee[];
  /** Ferme ou rouvre une tournée (un clic ; confirmation si la fiche colis liée est en cours). */
  basculerOuverture: (entree: EntreeAffectation) => void;
  /** Ouvre la feuille « Répartir » (tournée fusionnée) de cette affectation. */
  ouvrirRepartition: (entree: EntreeAffectation) => void;
}

export const Contexte = createContext<ContexteAffectations | null>(null);

export function useAffectations(): ContexteAffectations {
  const c = useContext(Contexte);
  if (!c) throw new Error("useAffectations hors de <Affectations>");
  return c;
}

// ---------------------------------------------------------------------------
// Pastille d'un chauffeur : initiales sur une couleur stable.
// ---------------------------------------------------------------------------

export function Avatar({ id, nom, taille = "md", attenue = false }: { id: string; nom: string; taille?: "sm" | "md" | "lg"; attenue?: boolean }) {
  const c = couleurChauffeur(id);
  const dimension = taille === "sm" ? "h-6 w-6 text-[10px]" : taille === "lg" ? "h-10 w-10 text-sm" : "h-8 w-8 text-xs";
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold ${dimension} ${attenue ? "opacity-50 grayscale" : ""}`}
      style={{ backgroundColor: c.fond, color: c.texte }}
    >
      {initiales(nom)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Glisser-déposer (@dnd-kit) : ce qu'on prend, où on le pose.
// ---------------------------------------------------------------------------

/** Élément glissable ; `actif` faux : simple conteneur (téléphone, absent, lecture seule). */
export function Glissable({ id, actif, className, style, children, ...reste }: { id: string; actif: boolean; className?: string; style?: CSSProperties; children: ReactNode } & Omit<React.HTMLAttributes<HTMLDivElement>, "id" | "className" | "style" | "children">) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled: !actif });
  return (
    <div
      ref={setNodeRef}
      {...(actif ? listeners : {})}
      {...(actif ? { "aria-roledescription": "élément glissable", "aria-describedby": attributes["aria-describedby"] } : {})}
      className={`${className ?? ""} ${actif ? "cursor-grab touch-none active:cursor-grabbing" : ""} ${isDragging ? "opacity-40" : ""}`}
      style={style}
      {...reste}
    >
      {children}
    </div>
  );
}

/** Zone de dépôt ; `children` reçoit l'état « survolée ». */
export function Depot({ id, actif, children }: { id: string; actif: boolean; children: (survol: boolean, ref: (el: HTMLElement | null) => void) => ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id, disabled: !actif });
  return <>{children(isOver && actif, setNodeRef)}</>;
}

/** Libellé court d'un véhicule. */
export function Vehicule({ immat }: { immat: string | null | undefined }) {
  if (!immat) return <span className="text-[11px] opacity-70">sans véhicule</span>;
  return <span className="whitespace-nowrap text-[11px] tabular-nums opacity-80">{immat}</span>;
}

/**
 * Heure de départ d'une tournée : un bouton « 07:00 ✎ » qui ouvre
 * « Heure de la tournée » pour qui peut modifier le planning, sinon du texte.
 */
export function BoutonHeure({ ligne, date = null, heure, className = "" }: { ligne: LigneTournee; date?: string | null; heure?: string; className?: string }) {
  const ctx = useAffectations();
  const h = heure ?? ligne.heure;
  if (!ctx.donnees.peutModifier) return <span className={`tabular-nums ${className}`}>{h}</span>;
  return (
    <button
      type="button"
      disabled={ctx.occupe}
      onClick={() => ctx.ouvrirHeure(ligne.cle, date)}
      aria-label={`Heure de départ de ${ligne.tourNumber} : ${h}. Modifier`}
      title="Modifier l'heure de départ"
      className={`inline-flex min-h-[32px] items-center gap-1 rounded-md px-1 tabular-nums underline decoration-dotted underline-offset-2 hover:bg-teal/15 hover:text-teal-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal max-md:min-h-[44px] max-md:px-2 ${className}`}
    >
      {h}
      <span aria-hidden="true" className="text-[0.9em] opacity-70">
        ✎
      </span>
    </button>
  );
}
