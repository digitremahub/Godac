import { paiementDuBulletin } from "@/lib/paie/paiement";
import { primeRecopieeSansMarqueur } from "@/lib/paie/primes";
import type { ParametresEntreprise, Prime, VariablesMois } from "@/lib/paie/types";

/**
 * « Préparer la paie du mois » : préparation de tous les bulletins en un
 * clic, comparaison au mois précédent et écran d'anomalies. Fichier pur
 * (aucune dépendance serveur), testé dans lib/paie/__tests__/lot.test.ts.
 *
 * Aucun calcul de paie ici : les bulletins sont produits par le même moteur
 * que l'éditeur unitaire (lib/paie/calcul.ts, via lib/paie/generation-serveur.ts),
 * à partir des mêmes valeurs préremplies (lib/paie/donnees.ts). Ce fichier ne
 * fait que reprendre ces valeurs, comparer des totaux et lister des alertes.
 */

/** Variation du net au-delà de laquelle un bulletin est signalé (en %, par rapport au mois précédent). */
export const SEUIL_VARIATION_NET_POURCENT = 20;

export type StatutPreparation = "a_preparer" | "prepare" | "valide";

export const LIBELLE_STATUT_PREPARATION: Record<StatutPreparation, string> = {
  a_preparer: "À préparer",
  prepare: "Préparé",
  valide: "Validé",
};

/** Statut d'un salarié ce mois : pas de bulletin = à préparer ; préparé (en attente ou refusé) ; validé par la direction. */
export function statutPreparation(bulletin: { validation_status?: string | null } | null | undefined): StatutPreparation {
  if (!bulletin) return "a_preparer";
  return bulletin.validation_status === "valide" ? "valide" : "prepare";
}

const num = (v: unknown) => Number(v ?? 0) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Variables du bulletin telles que l'éditeur les propose au chargement
 * (components/paie/PaieEditor.tsx) : mêmes valeurs préremplies, avant toute
 * saisie. C'est ce que « tout préparer » enregistre.
 */
export function variablesInitiales(prefill: VariablesMois, entreprise: Pick<ParametresEntreprise, "subrogation">, mois: string): Omit<VariablesMois, "cumulHeuresSupExonereesAnnee"> {
  const periodes = (prefill.periodesConges ?? []).filter((p) => p.du && p.au && p.jours > 0);
  const hs = prefill.heuresSup25 == null && prefill.heuresSup50 == null ? { heuresSup25: null, heuresSup50: null } : { heuresSup25: prefill.heuresSup25 ?? 0, heuresSup50: prefill.heuresSup50 ?? 0 };
  return {
    heuresTravaillees: prefill.heuresTravaillees ?? null,
    heuresAbsenceNonPayee: num(prefill.heuresAbsenceNonPayee),
    joursCongesPris: periodes.length ? periodes.reduce((t, p) => t + p.jours, 0) : num(prefill.joursCongesPris),
    periodesConges: periodes,
    ...hs,
    tauxRepas: prefill.tauxRepas ?? null,
    primes: prefill.primes.filter((p) => p.montant),
    nbRepas: num(prefill.nbRepas),
    nbRepasUnique: num(prefill.nbRepasUnique),
    nbCasseCroute: num(prefill.nbCasseCroute),
    nbGrandDeplacement: num(prefill.nbGrandDeplacement),
    retenues: (prefill.retenues ?? []).filter((r) => r.montant > 0),
    personnesACharge: num(prefill.personnesACharge),
    ...paiementDuBulletin(mois, prefill),
    typeTauxPas: prefill.typeTauxPas ?? null,
    arrets: (prefill.arrets ?? []).filter((a) => a.du && a.au && a.au >= a.du),
    subrogation: prefill.subrogation ?? entreprise.subrogation ?? false,
    cpReference: prefill.cpReference ?? null,
    sortie: prefill.sortie ?? null,
  };
}

// ── Lecture d'un bulletin enregistré ────────────────────────────────

/** Bulletin enregistré, tel que lu en base (payslips). */
export interface BulletinLu {
  net_amount?: number | string | null;
  validation_status?: string | null;
  variables?: Partial<VariablesMois> | null;
  details?: { heures?: { base?: number; sup25?: number; sup50?: number } } | null;
}

export interface ChiffresBulletin {
  net: number;
  heures: number | null;
  primes: number;
  primesLues: Prime[];
}

/** Net, heures et primes d'un bulletin. Heures : celles saisies, sinon celles détaillées par le moteur ; inconnues : null. */
export function chiffresBulletin(b: BulletinLu | null | undefined): ChiffresBulletin | null {
  if (!b) return null;
  const v = b.variables ?? {};
  const h = b.details?.heures;
  const detail = h ? num(h.base) + num(h.sup25) + num(h.sup50) : null;
  const primesLues = (v.primes ?? []) as Prime[];
  return {
    net: r2(num(b.net_amount)),
    heures: v.heuresTravaillees ?? (detail !== null && detail > 0 ? r2(detail) : null),
    primes: r2(primesLues.reduce((t, p) => t + num(p.montant), 0)),
    primesLues,
  };
}

// ── Comparaison au mois précédent ───────────────────────────────────

/** Écart en % de `courant` par rapport à `precedent` ; précédent nul ou inconnu : null. */
export function ecartPourcent(courant: number | null, precedent: number | null): number | null {
  if (courant === null || precedent === null || precedent === 0) return null;
  return r2(((courant - precedent) / Math.abs(precedent)) * 100);
}

export interface Ecart {
  courant: number | null;
  precedent: number | null;
  /** Courant − précédent ; null si l'un des deux est inconnu. */
  ecart: number | null;
  pourcent: number | null;
}

export function ecart(courant: number | null, precedent: number | null): Ecart {
  return { courant, precedent, ecart: courant !== null && precedent !== null ? r2(courant - precedent) : null, pourcent: ecartPourcent(courant, precedent) };
}

export interface LigneComparaison {
  userId: string;
  nom: string;
  statut: StatutPreparation;
  net: Ecart;
  heures: Ecart;
  primes: Ecart;
}

export function comparerAvecMoisPrecedent(p: { userId: string; nom: string; courant: BulletinLu | null; precedent: BulletinLu | null }): LigneComparaison {
  const c = chiffresBulletin(p.courant);
  const m = chiffresBulletin(p.precedent);
  return {
    userId: p.userId,
    nom: p.nom,
    statut: statutPreparation(p.courant),
    net: ecart(c?.net ?? null, m?.net ?? null),
    heures: ecart(c?.heures ?? null, m?.heures ?? null),
    primes: ecart(c ? c.primes : null, m ? m.primes : null),
  };
}

// ── Anomalies ───────────────────────────────────────────────────────

export type CodeAnomaliePaie = "taux_horaire_nul" | "sans_contrat" | "heures_manquantes" | "prime_sans_marqueur" | "net_negatif" | "variation_net";

/** « bloquante » : le bulletin ne peut pas être préparé ; « a_verifier » : préparé, à relire avant validation. */
export type GraviteAnomalie = "bloquante" | "a_verifier";

export interface AnomaliePaie {
  userId: string;
  nom: string;
  code: CodeAnomaliePaie;
  gravite: GraviteAnomalie;
  message: string;
}

export const LIBELLE_ANOMALIE: Record<CodeAnomaliePaie, string> = {
  taux_horaire_nul: "Taux horaire nul",
  sans_contrat: "Salarié sans contrat",
  heures_manquantes: "Heures manquantes",
  prime_sans_marqueur: "Prime recopiée sans marqueur",
  net_negatif: "Net négatif",
  variation_net: "Variation du net importante",
};

export interface EntreeAnomalies {
  userId: string;
  nom: string;
  /** Taux horaire du profil de paie (0 ou absent : nul). */
  tauxHoraire: number | null;
  /** Contrat enregistré (user_contracts ou type de contrat du dossier salarié). */
  aContrat: boolean;
  courant: BulletinLu | null;
  precedent: BulletinLu | null;
  /** Heures préremplies (avant préparation), quand on les connaît : sert aux salariés pas encore préparés. */
  heuresPrefill?: number | null;
  /** Primes préremplies (avant préparation). */
  primesPrefill?: readonly Prime[];
}

const pct = (n: number) => `${n > 0 ? "+" : ""}${String(n).replace(".", ",")} %`;
const eur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/** Anomalies d'un salarié ce mois (ordre : bloquantes d'abord). */
export function anomaliesDuSalarie(e: EntreeAnomalies, seuilVariation: number = SEUIL_VARIATION_NET_POURCENT): AnomaliePaie[] {
  const resultat: AnomaliePaie[] = [];
  const ajouter = (code: CodeAnomaliePaie, gravite: GraviteAnomalie, message: string) => resultat.push({ userId: e.userId, nom: e.nom, code, gravite, message });
  const c = chiffresBulletin(e.courant);

  if (!e.tauxHoraire || e.tauxHoraire <= 0) ajouter("taux_horaire_nul", "bloquante", "Taux horaire nul ou profil de paie à compléter : le bulletin ne peut pas être calculé.");
  if (!e.aContrat) ajouter("sans_contrat", "a_verifier", "Aucun contrat enregistré (rémunération, heures contractuelles, type de contrat) : à compléter dans la fiche salarié.");

  // Heures du bulletin préparé, sinon heures préremplies quand l'appelant les connaît ; inconnues : pas de contrôle.
  const heures = c ? c.heures : e.heuresPrefill;
  if (heures !== undefined && (heures === null || heures <= 0)) {
    ajouter("heures_manquantes", "a_verifier", "Aucune heure trouvée ce mois-ci (ni pointage, ni planning, ni tournée) : le bulletin repose sur les heures du contrat.");
  }

  const primes = c ? c.primesLues : (e.primesPrefill ?? []);
  const sansMarqueur = primes.filter(primeRecopieeSansMarqueur);
  if (sansMarqueur.length) {
    ajouter(
      "prime_sans_marqueur",
      "a_verifier",
      `${sansMarqueur.length === 1 ? "Prime recopiée" : `${sansMarqueur.length} primes recopiées`} du mois précédent sans marqueur « ponctuelle » ou « récurrente » (${sansMarqueur.map((p) => `${p.libelle || "sans libellé"} ${eur(p.montant)}`).join(", ")}) : risque de double paiement.`,
    );
  }

  if (c && c.net < 0) ajouter("net_negatif", "a_verifier", `Net à payer négatif (${eur(c.net)}) : retenues ou absences à vérifier.`);
  const m = chiffresBulletin(e.precedent);
  const variation = c && m ? ecartPourcent(c.net, m.net) : null;
  if (variation !== null && Math.abs(variation) > seuilVariation) {
    ajouter("variation_net", "a_verifier", `Net ${pct(variation)} par rapport au mois précédent (${eur(m!.net)} → ${eur(c!.net)}) ; seuil ${seuilVariation} %.`);
  }
  return resultat.sort((a, b) => Number(b.gravite === "bloquante") - Number(a.gravite === "bloquante"));
}

export function detecterAnomalies(entrees: readonly EntreeAnomalies[], seuilVariation: number = SEUIL_VARIATION_NET_POURCENT): AnomaliePaie[] {
  return entrees.flatMap((e) => anomaliesDuSalarie(e, seuilVariation));
}

/** Anomalies bloquantes d'un salarié : s'il y en a, le bulletin n'est pas préparé en lot. */
export const aUneAnomalieBloquante = (anomalies: readonly AnomaliePaie[], userId: string) => anomalies.some((a) => a.userId === userId && a.gravite === "bloquante");

// ── Bilan d'une préparation en lot ──────────────────────────────────

export interface BilanLot {
  prepares: number;
  ignores: { userId: string; nom: string; raison: string }[];
  erreurs: { userId: string; nom: string; erreur: string }[];
  /** Salariés restant à préparer (délai dépassé) : relancer. */
  restants: number;
}

/** Phrase de résumé affichée après « Préparer tous les bulletins ». */
export function resumeLot(b: BilanLot): string {
  const parties = [`${b.prepares} bulletin${b.prepares > 1 ? "s" : ""} préparé${b.prepares > 1 ? "s" : ""}, en attente de validation par la direction`];
  if (b.ignores.length) parties.push(`${b.ignores.length} non préparé${b.ignores.length > 1 ? "s" : ""} (anomalie bloquante)`);
  if (b.erreurs.length) parties.push(`${b.erreurs.length} en erreur`);
  if (b.restants) parties.push(`${b.restants} restant${b.restants > 1 ? "s" : ""} : relancez la préparation`);
  return `${parties.join(" ; ")}.`;
}
