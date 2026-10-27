/**
 * Données du bandeau « Planning de la semaine du … généré automatiquement — à
 * confirmer avant vendredi 17 h » (components/planning/BandeauSemaineAuto.tsx),
 * affiché en vue Semaine. Logique pure, testée dans
 * lib/planning/__tests__/semaines-auto.test.ts : la page lit la ligne de suivi et
 * les lignes du planning, ce fichier en tire ce qu'on montre, sans motif médical.
 */
import { libelleJour } from "@/lib/planning/semaine";
import {
  LIMITE_CONFIRMATION,
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
  etat: "a_confirmer" | "modifiee";
  /** Compteurs du résumé de génération, avec les cases à remplacer relues en direct. */
  compteurs: { tournees: number; chauffeurs: number; aRemplacer: number; fermees: number; conflits: number };
  /** Cases sans chauffeur en ce moment (absents, modèles, chauffeur retiré). */
  aRemplacer: ElementBandeau[];
  /** Chauffeurs affectés mais devenus absents depuis la génération. */
  absentsApparus: ElementBandeau[];
  /** Lecture seule : la personne ne peut pas modifier le planning. */
  peutConfirmer: boolean;
}

const lienCase = (entreeId: string, serviceId: string) => `/exploitation/planning?entry=${encodeURIComponent(entreeId)}&service=${encodeURIComponent(serviceId)}`;

export function construireBandeau(p: {
  ligne: LigneSuivi;
  service: string;
  lignes: readonly LigneBandeau[];
  contexte: ContexteAbsences;
  peutConfirmer: boolean;
}): BandeauSemaine | null {
  const etat = etatSemaine(p.ligne);
  if (etat === "publiee") return null;
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
    titre: `Planning ${libelleSemaine(p.ligne.semaine_debut)} généré automatiquement — à confirmer avant ${LIMITE_CONFIRMATION}`,
    etat,
    compteurs: { tournees: resume.tournees, chauffeurs: resume.chauffeurs, aRemplacer: aRemplacer.length, fermees: resume.fermees, conflits: resume.conflits },
    aRemplacer,
    absentsApparus,
    peutConfirmer: p.peutConfirmer,
  };
}
