/**
 * Données du bandeau « Planning de la semaine du … généré automatiquement — à
 * confirmer avant vendredi 17 h » (components/planning/BandeauSemaineAuto.tsx),
 * affiché en vue Semaine. Logique pure, testée dans
 * lib/planning/__tests__/semaines-auto.test.ts : la page lit la ligne de suivi et
 * les lignes du planning, ce fichier en tire ce qu'on montre, sans motif médical.
 */
import { libelleJour, type AffectationPlanning } from "@/lib/planning/semaine";
import {
  LIMITE_CONFIRMATION,
  MESSAGE_SANS_SOURCE,
  choisirSemaineSource,
  envoiAutomatiquePrevu,
  estSemainePreparable,
  libelleDateHeureParis,
  libelleLundi,
  lundisAvecAffectations,
  affectationsDeChauffeursAbsents,
  casesSansChauffeur,
  etatSemaine,
  libelleAbsent,
  libelleSemaine,
  lireResume,
  type ContexteAbsences,
  type LigneBandeau,
  type LigneSuivi,
} from "@/lib/planning/semaines-auto";

export interface ElementBandeau {
  /** Lien vers la case (le planning s'ouvre sur son jour). */
  href: string;
  texte: string;
}

export interface BandeauSemaine {
  serviceId: string;
  service: string;
  lundi: string;
  titre: string;
  etat: "a_confirmer" | "modifiee" | "publiee";
  /** Semaine suivante (N+1) : envoyée toute seule le vendredi 17 h. Plus loin : envoyée à la confirmation seulement. */
  envoiAuto: boolean;
  /** Semaine publiée : « vendredi 6 novembre à 17:12 » (heure de Paris), sinon null. */
  publieLe: string | null;
  publieAuto: boolean;
  /** Compteurs du résumé de génération, avec les cases à remplacer relues en direct. */
  compteurs: { tournees: number; chauffeurs: number; aRemplacer: number; fermees: number; conflits: number };
  /** Cases sans chauffeur en ce moment (absents, modèles, chauffeur retiré). */
  aRemplacer: ElementBandeau[];
  /** Chauffeurs affectés mais devenus absents depuis la génération. */
  absentsApparus: ElementBandeau[];
  /** Lecture seule : la personne ne peut pas modifier le planning. */
  peutConfirmer: boolean;
}

/** Semaine à venir sans suivi : proposée à la génération à la demande, par service. */
export interface SemaineAPreparer {
  serviceId: string;
  service: string;
  lundi: string;
  /** Lundi de la semaine qui sera recopiée ; null s'il n'y en a aucune (message à la place du bouton). */
  source: string | null;
  titre: string;
  /** Libellé du bouton, explicite : « Générer le planning de la semaine du … à partir de la semaine du … ». */
  bouton: string | null;
  message: string | null;
}

const lienCase = (entreeId: string, serviceId: string) => `/exploitation/planning?entry=${encodeURIComponent(entreeId)}&service=${encodeURIComponent(serviceId)}`;

export function construireBandeau(p: {
  ligne: LigneSuivi;
  service: string;
  lignes: readonly LigneBandeau[];
  contexte: ContexteAbsences;
  peutConfirmer: boolean;
  /** Jour de Paris (AAAA-MM-JJ) : distingue la semaine suivante (envoi automatique) des suivantes. Absent : semaine suivante. */
  aujourdhui?: string;
}): BandeauSemaine | null {
  const etat = etatSemaine(p.ligne);
  const envoiAuto = p.aujourdhui ? envoiAutomatiquePrevu(p.ligne.semaine_debut, p.aujourdhui) : true;
  if (etat === "publiee") {
    // Semaine publiée : une simple mention, sans bouton, tant que la semaine n'a pas commencé.
    const quand = p.ligne.publie_at ?? p.ligne.confirme_at;
    if (!p.aujourdhui || p.ligne.semaine_debut <= p.aujourdhui || !quand) return null;
    return {
      serviceId: p.ligne.service_id,
      service: p.service,
      lundi: p.ligne.semaine_debut,
      titre: `Semaine publiée aux chauffeurs le ${libelleDateHeureParis(quand)}`,
      etat,
      envoiAuto,
      publieLe: libelleDateHeureParis(quand),
      publieAuto: p.ligne.publie_mode === "auto",
      compteurs: { tournees: 0, chauffeurs: 0, aRemplacer: 0, fermees: 0, conflits: 0 },
      aRemplacer: [],
      absentsApparus: [],
      peutConfirmer: false,
    };
  }
  const resume = lireResume(p.ligne.resume);
  const absentGenere = new Map(resume.absents.filter((a) => a.entree_id).map((a) => [a.entree_id!, a]));

  const cases = casesSansChauffeur(p.lignes);
  const aRemplacer = cases.map((c) => {
    const a = absentGenere.get(c.entree_id);
    return {
      href: lienCase(c.entree_id, p.ligne.service_id),
      texte: `${libelleJour(c.jour)} ${c.heure} · n°${c.tournee} — ${a ? libelleAbsent(a) : "sans chauffeur"}`,
    };
  });
  const absentsApparus = affectationsDeChauffeursAbsents(p.lignes, p.contexte).map((a) => ({
    href: lienCase(a.entree_id, p.ligne.service_id),
    texte: `${libelleJour(a.jour)} ${a.heure} · n°${a.tournee} — ${libelleAbsent(a)}`,
  }));

  return {
    serviceId: p.ligne.service_id,
    service: p.service,
    lundi: p.ligne.semaine_debut,
    titre: envoiAuto
      ? `Planning ${libelleSemaine(p.ligne.semaine_debut)} généré automatiquement — à confirmer avant ${LIMITE_CONFIRMATION}`
      : `Planning ${libelleSemaine(p.ligne.semaine_debut)} préparé à l'avance — à confirmer pour l'envoyer aux chauffeurs`,
    etat,
    envoiAuto,
    publieLe: null,
    publieAuto: false,
    compteurs: { tournees: resume.tournees, chauffeurs: resume.chauffeurs, aRemplacer: aRemplacer.length, fermees: resume.fermees, conflits: resume.conflits },
    aRemplacer,
    absentsApparus,
    peutConfirmer: p.peutConfirmer,
  };
}


/**
 * Semaines à venir proposées à la génération à la demande : celles de la fenêtre
 * (semaine suivante et jusqu'à 8 semaines) qui n'ont encore ni suivi ni publication,
 * pour chaque service. `lignes` : affectations des 4 semaines qui précèdent (source).
 */
export function semaineAPreparer(p: {
  serviceId: string;
  service: string;
  lundi: string;
  aujourdhui: string;
  /** La semaine a déjà une ligne de suivi ou une publication. */
  dejaSuivie: boolean;
  lignesSources: readonly AffectationPlanning[];
}): SemaineAPreparer | null {
  if (p.dejaSuivie || !estSemainePreparable(p.lundi, p.aujourdhui)) return null;
  const source = choisirSemaineSource(p.lundi, lundisAvecAffectations(p.lignesSources));
  const titre = "Cette semaine n'est pas encore préparée";
  if (!source) return { serviceId: p.serviceId, service: p.service, lundi: p.lundi, source: null, titre, bouton: null, message: MESSAGE_SANS_SOURCE };
  return {
    serviceId: p.serviceId,
    service: p.service,
    lundi: p.lundi,
    source,
    titre,
    bouton: `Générer le planning de la semaine du ${libelleLundi(p.lundi)} à partir de la semaine du ${libelleLundi(source)}`,
    message: null,
  };
}
