import { MAINTIEN_LEGAL } from "@/lib/paie/parametres";
import type { ArretTravail, ParametresLegaux, ParametresMaintien, TypeArret } from "@/lib/paie/types";

// Arrêts de travail sur le bulletin — logique pure, testée dans
// lib/paie/__tests__/arrets.test.ts.
//
// Méthode retenue (documentée, à faire valider par le comptable) :
// - absence : méthode des jours calendaires réels — salaire mensuel de
//   référence (base + heures d'équivalence du contrat) × jours d'arrêt du
//   mois ÷ jours calendaires du mois ; un mois entier d'arrêt retire tout
//   le salaire de référence. Les congés payés gardent leur décompte en
//   jours ouvrables (1/26), neutralisé par l'indemnité ;
// - IJSS : 3 jours de carence Sécurité sociale pour la maladie, aucun
//   pour un AT / maladie professionnelle, un accident de trajet, la
//   maternité ou la paternité ; montant journalier saisi (relevé CPAM) ;
// - maintien légal (L1226-1, D1226-1 s.) : jour par jour, depuis le début
//   de l'arrêt initial (prolongation comprise), après la carence
//   employeur, taux × salaire journalier − IJSS brutes du jour ; si un
//   maintien conventionnel est réglé, le plus favorable des deux
//   s'applique jour par jour ;
// - les durées s'apprécient arrêt par arrêt : le cumul des arrêts sur 12
//   mois glissants (D1226-4) n'est pas suivi — avertissement.

export const LIBELLE_ARRET: Record<TypeArret, string> = {
  maladie: "Absence maladie",
  at_mp: "Absence accident du travail / maladie professionnelle",
  trajet: "Absence accident de trajet",
  maternite: "Absence congé maternité",
  paternite: "Absence congé paternité",
  sans_solde: "Congé sans solde",
};

/** Libellé court pour les listes de choix. */
export const TYPES_ARRET: { key: TypeArret; label: string }[] = [
  { key: "maladie", label: "Maladie" },
  { key: "at_mp", label: "Accident du travail / maladie professionnelle" },
  { key: "trajet", label: "Accident de trajet" },
  { key: "maternite", label: "Maternité" },
  { key: "paternite", label: "Paternité / accueil de l'enfant" },
  { key: "sans_solde", label: "Congé sans solde" },
];

/** Carence de la Sécurité sociale avant le versement des IJSS (jours). */
export const CARENCE_IJSS: Record<TypeArret, number> = { maladie: 3, at_mp: 0, trajet: 0, maternite: 0, paternite: 0, sans_solde: 0 };

/** Arrêts ouvrant droit au maintien de salaire légal. */
const AVEC_MAINTIEN: TypeArret[] = ["maladie", "at_mp", "trajet"];
/** Arrêts d'origine professionnelle (carence employeur « AT »). */
const PROFESSIONNEL: TypeArret[] = ["at_mp"];
/** IJSS imposables à 50 % seulement (AT / maladie professionnelle, accident de trajet). */
const IJSS_MOITIE_IMPOSABLE: TypeArret[] = ["at_mp", "trajet"];

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const date = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const jour = (d: Date) => d.toISOString().slice(0, 10);
const JOUR = 86_400_000;

/** Jours calendaires entre deux dates incluses. */
export function joursCalendaires(du: string, au: string): number {
  if (!du || !au || au < du) return 0;
  return Math.round((date(au).getTime() - date(du).getTime()) / JOUR) + 1;
}

/** Mois complets d'ancienneté entre l'entrée et une date. */
export function ancienneteMois(entree: string, au: string): number {
  const [y0, m0, d0] = entree.slice(0, 10).split("-").map(Number) as [number, number, number];
  const [y1, m1, d1] = au.slice(0, 10).split("-").map(Number) as [number, number, number];
  return Math.max(0, (y1 - y0) * 12 + (m1 - m0) - (d1 < d0 ? 1 : 0));
}

/** Durée de chaque période de maintien (jours) selon l'ancienneté en années révolues. */
export function dureePeriodeMaintien(anneesAnciennete: number, p: ParametresMaintien = MAINTIEN_LEGAL): number {
  if (anneesAnciennete * 12 < p.ancienneteMinMois) return 0;
  const tranches = p.trancheAnnees > 0 ? Math.floor(Math.max(0, anneesAnciennete - 1) / p.trancheAnnees) : 0;
  return Math.min(p.dureeBase + tranches * p.dureeIncrement, p.dureeMax);
}

/** Taux de maintien (en %) du k-ième jour d'arrêt (1 = premier jour), 0 hors droit. */
export function tauxMaintienDuJour(type: TypeArret, k: number, moisAnciennete: number, p: ParametresMaintien = MAINTIEN_LEGAL): number {
  if (!AVEC_MAINTIEN.includes(type) || moisAnciennete < p.ancienneteMinMois) return 0;
  const carence = PROFESSIONNEL.includes(type) ? p.carenceAt : p.carenceMaladie;
  const j = k - carence;
  if (j <= 0) return 0;
  const duree = dureePeriodeMaintien(Math.floor(moisAnciennete / 12), p);
  if (j <= duree) return p.taux1;
  if (j <= 2 * duree) return p.taux2;
  return 0;
}

export interface CalculArret {
  type: TypeArret;
  libelle: string;
  /** Bornes de l'arrêt dans le mois. */
  du: string;
  au: string;
  /** Jours calendaires d'arrêt dans le mois. */
  jours: number;
  salaireJour: number;
  deduction: number;
  joursIjss: number;
  ijssBrutes: number;
  ijssNettes: number;
  /** IJSS imposables à 50 % (AT, trajet). */
  ijssMoitieImposable: boolean;
  maintien: number;
  /** Précision du maintien (taux, carence, origine). */
  mention: string;
  avertissements: string[];
}

/**
 * Effet d'un arrêt sur le bulletin d'un mois : jours d'absence, retenue,
 * IJSS du mois, maintien de salaire employeur.
 */
export function calculerArret(params: {
  arret: ArretTravail;
  debutMois: string;
  finMois: string;
  /** Salaire mensuel de référence (brut du contrat, hors heures sup.). */
  salaireMensuel: number;
  dateEntree?: string | null;
  /** Maintien conventionnel / d'entreprise (réglages), comparé au légal. */
  maintienConventionnel?: ParametresMaintien | null;
  legal?: Pick<ParametresLegaux, "ijss">;
}): CalculArret {
  const { arret, debutMois, finMois, salaireMensuel } = params;
  const du = arret.du < debutMois ? debutMois : arret.du;
  const au = arret.au > finMois ? finMois : arret.au;
  const jours = joursCalendaires(du, au);
  const joursMois = joursCalendaires(debutMois, finMois);
  const salaireJour = joursMois > 0 ? salaireMensuel / joursMois : 0;
  const origine = arret.prolongationDu && arret.prolongationDu < arret.du ? arret.prolongationDu : arret.du;
  const avertissements: string[] = [];
  const ijssJour = Math.max(0, arret.ijssBrutesJour ?? 0);
  const mois = params.dateEntree ? ancienneteMois(params.dateEntree, origine) : null;

  let joursIjssCalcules = 0;
  let maintien = 0;
  let joursMaintenus = 0;
  const tauxVus = new Set<number>();
  let conventionnelRetenu = false;
  for (let i = 0; i < jours; i++) {
    const d = jour(new Date(date(du).getTime() + i * JOUR));
    const k = joursCalendaires(origine, d);
    const ijDuJour = arret.type !== "sans_solde" && k > CARENCE_IJSS[arret.type];
    if (ijDuJour) joursIjssCalcules++;
    if (mois === null) continue;
    const legalTaux = tauxMaintienDuJour(arret.type, k, mois, MAINTIEN_LEGAL);
    const convTaux = params.maintienConventionnel ? tauxMaintienDuJour(arret.type, k, mois, params.maintienConventionnel) : 0;
    const taux = Math.max(legalTaux, convTaux);
    if (taux <= 0) continue;
    if (convTaux > legalTaux) conventionnelRetenu = true;
    tauxVus.add(taux);
    joursMaintenus++;
    maintien += Math.max(0, (taux / 100) * salaireJour - (ijDuJour ? ijssJour : 0));
  }

  const joursIjss = arret.joursIjss !== null && arret.joursIjss !== undefined ? Math.max(0, Math.min(arret.joursIjss, jours)) : joursIjssCalcules;
  const ijssBrutes = r2(joursIjss * ijssJour);
  const t = params.legal?.ijss ?? { csgDeductible: 3.8, csgNonDeductible: 2.4, crds: 0.5 };
  const ijssNettes =
    arret.ijssNettesJour !== null && arret.ijssNettesJour !== undefined && arret.ijssNettesJour > 0
      ? r2(joursIjss * arret.ijssNettesJour)
      : r2(ijssBrutes * (1 - (t.csgDeductible + t.csgNonDeductible + t.crds) / 100));

  let mention = "";
  if (arret.maintienManuel !== null && arret.maintienManuel !== undefined && arret.maintienManuel >= 0) {
    maintien = arret.maintienManuel;
    mention = "maintien saisi";
  } else if (AVEC_MAINTIEN.includes(arret.type)) {
    if (mois === null) {
      avertissements.push(`${LIBELLE_ARRET[arret.type]} : date d'entrée inconnue, maintien de salaire non calculé (renseignez-la au dossier salarié ou saisissez le maintien).`);
    } else if (joursMaintenus === 0) {
      const p = params.maintienConventionnel ?? MAINTIEN_LEGAL;
      mention = mois < Math.min(MAINTIEN_LEGAL.ancienneteMinMois, p.ancienneteMinMois) ? "pas de maintien : moins d'un an d'ancienneté" : "pas de maintien ce mois (carence ou droits épuisés)";
    } else {
      const carence = PROFESSIONNEL.includes(arret.type) ? "sans carence" : `carence ${conventionnelRetenu ? params.maintienConventionnel!.carenceMaladie : MAINTIEN_LEGAL.carenceMaladie} j`;
      mention = `${conventionnelRetenu ? "conventionnel" : "légal"} ${Array.from(tauxVus).map((x) => `${String(x).replace(".", ",")} %`).join(" puis ")}, ${carence}, ${joursMaintenus} j`;
      if (!ijssJour) avertissements.push(`${LIBELLE_ARRET[arret.type]} : IJSS non saisies, le maintien est calculé sans les déduire — à régulariser à réception du relevé CPAM.`);
    }
  } else if (arret.type === "maternite" || arret.type === "paternite") {
    mention = "pas de maintien légal (IJSS seules ; maintien conventionnel à saisir le cas échéant)";
  }

  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return {
    type: arret.type,
    libelle: `${LIBELLE_ARRET[arret.type]} du ${fmt(du)} au ${fmt(au)}`,
    du,
    au,
    jours,
    salaireJour: r2(salaireJour),
    deduction: jours >= joursMois ? r2(salaireMensuel) : r2(jours * salaireJour),
    joursIjss,
    ijssBrutes,
    ijssNettes,
    ijssMoitieImposable: IJSS_MOITIE_IMPOSABLE.includes(arret.type),
    maintien: r2(maintien),
    mention,
    avertissements,
  };
}

/**
 * Arrêts proposés sur un bulletin déjà généré : la ligne enregistrée
 * (work_stoppages) fait foi quand elle existe — dates corrigées par
 * l'encadrement, IJSS saisies —, les arrêts déclarés depuis la
 * génération s'ajoutent, ceux refusés depuis disparaissent. Les arrêts
 * du bulletin sans ligne enregistrée (table absente) sont gardés.
 */
export function arretsDuBulletin(bulletin: readonly ArretTravail[] | null | undefined, enBase: readonly ArretTravail[], refuses: readonly string[] = []): ArretTravail[] {
  if (!bulletin) return [...enBase];
  const parId = new Map(enBase.filter((a) => a.id).map((a) => [a.id!, a]));
  const refus = new Set(refuses);
  const garde = bulletin.filter((a) => !a.id || !refus.has(a.id)).map((a) => (a.id && parId.get(a.id)) || a);
  const vus = new Set(garde.map((a) => a.id).filter(Boolean));
  return [...garde, ...enBase.filter((a) => a.id && !vus.has(a.id))].sort((a, b) => a.du.localeCompare(b.du));
}
