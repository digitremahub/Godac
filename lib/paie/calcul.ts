import type { Bulletin, LigneBulletin, ParametresEntreprise, ParametresLegaux, ProfilSalarie, Retenue, Section, TypeRetenue, VariablesMois } from "@/lib/paie/types";
import { partSaisissableMensuelle } from "@/lib/paie/parametres";

/** Libellé sur le bulletin de chaque type de retenue après le net. */
export const LIBELLE_RETENUE: Record<TypeRetenue, string> = {
  acompte: "Acompte versé",
  saisie: "Saisie sur salaire",
  atd: "Saisie administrative (ATD)",
  pension: "Pension alimentaire (paiement direct)",
  pret: "Remboursement de prêt",
  autre: "Retenue",
};

/**
 * Calcul d'un bulletin de paie mensuel — fonction pure, sans accès base
 * de données, pour pouvoir l'afficher en direct dans l'écran de
 * préparation et la tester ligne à ligne (lib/paie/__tests__).
 *
 * Périmètre volontairement explicite (voir aussi `avertissements`) :
 * mois complet (pas de proratisation d'entrée/sortie), décompte mensuel
 * des heures (pas de décompte trimestriel conventionnel), maintien de
 * salaire pendant les congés payés, pas d'indemnités journalières. Ce
 * qui sort de ce périmètre se saisit en prime/retenue manuelle.
 */

/** Durée légale mensualisée : 35 h × 52 / 12. */
export const HEURES_LEGALES = 151.67;
/** 43 h × 52 / 12 : au-delà, majoration de 50 %. */
export const SEUIL_HS_50 = 186.33;
/** Durée d'équivalence mensualisée par régime (au-delà de 35 h, heures majorées à 25 %). */
export const HEURES_EQUIVALENCE: Record<ProfilSalarie["regime"], number> = {
  grand_routier: 186.33,
  courte_distance: 169,
  sedentaire: HEURES_LEGALES,
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pct = (base: number, taux: number) => r2((base * taux) / 100);

export function tauxNeutre(grille: ParametresLegaux["tauxNeutrePas"], netImposable: number): number {
  for (const tranche of grille) {
    if (tranche.jusqua === null || netImposable < tranche.jusqua) return tranche.taux;
  }
  return grille[grille.length - 1]?.taux ?? 0;
}

export function calculerBulletin({
  legal,
  entreprise,
  salarie,
  variables,
}: {
  legal: ParametresLegaux;
  entreprise: ParametresEntreprise;
  salarie: ProfilSalarie;
  variables: VariablesMois;
}): Bulletin {
  const lignes: LigneBulletin[] = [];
  const avertissements: string[] = [];
  const add = (section: Section, libelle: string, l: Partial<LigneBulletin>) =>
    lignes.push({ section, libelle, base: null, tauxSalarial: null, montantSalarial: null, tauxPatronal: null, montantPatronal: null, ...l });

  // ── Heures et brut ─────────────────────────────────────────────
  // Mensualisation : le contrat est payé même si le mois réel est plus
  // court (les absences se déclarent à part) ; les heures en plus du
  // contrat s'ajoutent.
  const heuresPayees = Math.max(salarie.heuresContractuelles, variables.heuresTravaillees ?? 0);
  const heuresBase = Math.min(heuresPayees, HEURES_LEGALES);
  const equivalence = HEURES_EQUIVALENCE[salarie.regime];
  const sup25 = r2(Math.max(0, Math.min(heuresPayees, SEUIL_HS_50) - HEURES_LEGALES));
  const sup50 = r2(Math.max(0, heuresPayees - SEUIL_HS_50));
  const t = salarie.tauxHoraire;

  if (salarie.tauxHoraire < legal.smicHoraire) {
    avertissements.push(`Taux horaire inférieur au SMIC (${legal.smicHoraire.toFixed(2)} €).`);
  }

  const montantBase = r2(heuresBase * t);
  add("brut", "Salaire de base", { base: heuresBase, tauxSalarial: t, montantSalarial: montantBase, gain: true });

  // Heures entre 35 h et la durée d'équivalence (conducteurs) puis au-delà.
  const hEquiv = r2(Math.max(0, Math.min(sup25, equivalence - HEURES_LEGALES)));
  const hSup25 = r2(sup25 - hEquiv);
  const montantEquiv = r2(hEquiv * t * 1.25);
  const montantSup25 = r2(hSup25 * t * 1.25);
  const montantSup50 = r2(sup50 * t * 1.5);
  if (hEquiv > 0) add("brut", "Heures d'équivalence majorées 25 %", { base: hEquiv, tauxSalarial: r2(t * 1.25), montantSalarial: montantEquiv, gain: true });
  if (hSup25 > 0) add("brut", "Heures supplémentaires 25 %", { base: hSup25, tauxSalarial: r2(t * 1.25), montantSalarial: montantSup25, gain: true });
  if (sup50 > 0) add("brut", "Heures supplémentaires 50 %", { base: sup50, tauxSalarial: r2(t * 1.5), montantSalarial: montantSup50, gain: true });

  const absence = r2(variables.heuresAbsenceNonPayee * t);
  if (absence > 0) add("brut", "Absence non rémunérée", { base: variables.heuresAbsenceNonPayee, tauxSalarial: t, montantSalarial: -absence, gain: true });

  let primesSoumises = 0;
  let primesNonSoumises = 0;
  for (const p of variables.primes) {
    if (!p.montant) continue;
    add("brut", p.libelle || "Prime", { montantSalarial: r2(p.montant), gain: true });
    if (p.soumise) primesSoumises += p.montant;
    else primesNonSoumises += p.montant;
  }

  const montantHs = r2(montantEquiv + montantSup25 + montantSup50);
  const brut = r2(montantBase + montantHs - absence + primesSoumises);

  // ── Assiettes ──────────────────────────────────────────────────
  const pmss = legal.pmss;
  const t1 = Math.min(brut, pmss);
  const t2 = Math.max(0, Math.min(brut, 8 * pmss) - pmss);
  const smicMensuel = legal.smicHoraire * HEURES_LEGALES;
  // SMIC de référence de la réduction générale (RGDU) : SMIC de la
  // formule × durée légale, porté à 45/35 (grands routiers) ou 40/35
  // (courte distance) pour les conducteurs en régime d'équivalence
  // (art. D241-10 CSS), diminué des absences non payées.
  const facteurEquivalence = salarie.regime === "grand_routier" ? 45 / 35 : salarie.regime === "courte_distance" ? 40 / 35 : 1;
  const smicRef = legal.reductionGenerale.smicHoraireReference * Math.max(HEURES_LEGALES * facteurEquivalence - variables.heuresAbsenceNonPayee, 0);
  const eligibleRgdu = brut > 0 && brut < legal.reductionGenerale.plafondSmic * smicRef;

  let totalSal = 0;
  let totalPat = 0;
  const cot = (section: Section, libelle: string, base: number, sal: number | null, pat: number | null) => {
    const ms = sal !== null ? pct(base, sal) : null;
    const mp = pat !== null ? pct(base, pat) : null;
    totalSal += ms ?? 0;
    totalPat += mp ?? 0;
    add(section, libelle, { base: r2(base), tauxSalarial: sal, montantSalarial: ms, tauxPatronal: pat, montantPatronal: mp });
    return { ms: ms ?? 0, mp: mp ?? 0 };
  };

  // ── Santé ──
  const maladieTaux = brut <= legal.maladie.seuilReduitSmic * smicMensuel ? legal.maladie.reduit : legal.maladie.normal;
  const maladie = cot("sante", "Sécurité sociale — maladie, maternité, invalidité, décès", brut, null, maladieTaux);
  const at = cot("sante", "Accidents du travail — maladies professionnelles", brut, null, entreprise.tauxAccidentTravail);
  const prevoyanceTaux = salarie.cadre ? { salarial: entreprise.prevoyance.salarial, patronal: Math.max(entreprise.prevoyance.patronal, legal.prevoyanceCadreMinT1) } : entreprise.prevoyance;
  let prevoyancePatronale = 0;
  if (prevoyanceTaux.salarial || prevoyanceTaux.patronal) {
    prevoyancePatronale = cot("sante", salarie.cadre ? "Prévoyance cadre" : "Prévoyance conventionnelle", t1, prevoyanceTaux.salarial, prevoyanceTaux.patronal).mp;
  }
  if (entreprise.mutuelle.salarial || entreprise.mutuelle.patronal) {
    totalSal += entreprise.mutuelle.salarial;
    totalPat += entreprise.mutuelle.patronal;
    add("sante", "Complémentaire santé", { montantSalarial: r2(entreprise.mutuelle.salarial), montantPatronal: r2(entreprise.mutuelle.patronal) });
  }

  // ── Retraite ──
  const vp = cot("retraite", "Sécurité sociale plafonnée", t1, legal.vieillessePlafonnee.salarial, legal.vieillessePlafonnee.patronal);
  const vd = cot("retraite", "Sécurité sociale déplafonnée", brut, legal.vieillesseDeplafonnee.salarial, legal.vieillesseDeplafonnee.patronal);
  const aa1 = cot("retraite", "Complémentaire Agirc-Arrco tranche 1", t1, legal.agircArrcoT1.salarial, legal.agircArrcoT1.patronal);
  const ceg1 = cot("retraite", "Contribution d'équilibre général T1", t1, legal.cegT1.salarial, legal.cegT1.patronal);
  let salRetraiteT2 = 0;
  if (t2 > 0) {
    salRetraiteT2 += cot("retraite", "Complémentaire Agirc-Arrco tranche 2", t2, legal.agircArrcoT2.salarial, legal.agircArrcoT2.patronal).ms;
    salRetraiteT2 += cot("retraite", "Contribution d'équilibre général T2", t2, legal.cegT2.salarial, legal.cegT2.patronal).ms;
    salRetraiteT2 += cot("retraite", "Contribution d'équilibre technique", t1 + t2, legal.cet.salarial, legal.cet.patronal).ms;
  }
  if (salarie.cadre) cot("retraite", "APEC", Math.min(brut, 4 * pmss), legal.apec.salarial, legal.apec.patronal);

  // ── Famille ──
  const afTaux = brut <= legal.allocationsFamiliales.seuilReduitSmic * smicMensuel ? legal.allocationsFamiliales.reduit : legal.allocationsFamiliales.normal;
  const af = cot("famille", "Allocations familiales", brut, null, afTaux);

  // ── Chômage ──
  const chomage = cot("chomage", "Assurance chômage", Math.min(brut, 4 * pmss), null, legal.chomage);
  cot("chomage", "AGS", Math.min(brut, 4 * pmss), null, legal.ags);

  // ── Autres contributions employeur ──
  const fnal50 = entreprise.effectif >= 50;
  const fnal = cot("autres", "FNAL", fnal50 ? brut : t1, null, fnal50 ? legal.fnal.auMoins50 : legal.fnal.moins50);
  const csa = cot("autres", "Contribution solidarité autonomie", brut, null, legal.csa);
  cot("autres", "Contribution au dialogue social", brut, null, legal.dialogueSocial);
  cot("autres", "Formation professionnelle", brut, null, entreprise.effectif >= 11 ? legal.formationPro.auMoins11 : legal.formationPro.moins11);
  cot("autres", "Taxe d'apprentissage", brut, null, legal.taxeApprentissage);
  if (entreprise.effectif >= 11 && entreprise.tauxVersementMobilite > 0) cot("autres", "Versement mobilité", brut, null, entreprise.tauxVersementMobilite);

  // ── CSG / CRDS ──
  // Assiette : 98,25 % du brut (dans la limite de 4 PMSS) + part patronale
  // de prévoyance et de complémentaire santé, à 100 %.
  const brutHorsHs = brut - montantHs;
  const abattu = (x: number) => Math.min(x, 4 * pmss) * (legal.assietteCsgPart / 100) + Math.max(0, x - 4 * pmss);
  const assietteCsg = r2(abattu(brut) + prevoyancePatronale + entreprise.mutuelle.patronal);
  // La CSG sur la part « heures sup » est entièrement non déductible.
  const assietteCsgHs = r2(abattu(brut) - abattu(brutHorsHs));
  const csgDed = cot("csg", "CSG déductible de l'impôt sur le revenu", assietteCsg - assietteCsgHs, legal.csgDeductible, null);
  const csgNonDed = cot("csg", "CSG/CRDS non déductible de l'impôt sur le revenu", assietteCsg, legal.csgNonDeductible + legal.crds, null);
  let csgHs = { ms: 0, mp: 0 };
  if (assietteCsgHs > 0) csgHs = cot("csg", "CSG non déductible sur heures supplémentaires", assietteCsgHs, legal.csgDeductible, null);

  // ── Exonérations ───────────────────────────────────────────────
  // Réduction de cotisations salariales sur heures sup, plafonnée aux
  // cotisations salariales d'assurance vieillesse effectivement dues.
  let reductionHs = 0;
  if (montantHs > 0) {
    const plafond = vp.ms + vd.ms + aa1.ms + ceg1.ms + salRetraiteT2;
    reductionHs = r2(Math.min(pct(montantHs, legal.heuresSup.reductionSalariale), (plafond * montantHs) / Math.max(brut, 1)));
    totalSal -= reductionHs;
    add("exonerations", "Réduction de cotisations salariales heures sup.", { base: montantHs, tauxSalarial: -legal.heuresSup.reductionSalariale, montantSalarial: -reductionHs });
  }
  const nbHs = r2(hEquiv + hSup25 + sup50);
  if (nbHs > 0 && eligibleRgdu) {
    const parHeure = entreprise.effectif < 20 ? legal.heuresSup.deductionPatronaleParHeure.moins20 : legal.heuresSup.deductionPatronaleParHeure.de20a249;
    const deduction = r2(nbHs * parHeure);
    if (deduction > 0) {
      totalPat -= deduction;
      add("exonerations", "Déduction forfaitaire patronale heures sup.", { base: nbHs, tauxPatronal: null, montantPatronal: -deduction });
    }
  }

  // Réduction générale dégressive des cotisations patronales.
  let reductionGenerale = 0;
  if (smicRef > 0 && eligibleRgdu) {
    const rg = legal.reductionGenerale;
    const tDelta = fnal50 ? rg.tDelta.fnal050 : rg.tDelta.fnal010;
    const ratio = 0.5 * ((rg.plafondSmic * smicRef) / brut - 1);
    const coef = Math.min(rg.tMin + tDelta * Math.pow(Math.max(ratio, 0), rg.puissance), rg.tMin + tDelta);
    const eligibles = maladie.mp + vp.mp + vd.mp + af.mp + chomage.mp + fnal.mp + csa.mp + Math.min(at.mp, pct(brut, 0.5)) + aa1.mp + ceg1.mp;
    reductionGenerale = r2(Math.min(coef * brut, eligibles));
    if (reductionGenerale > 0) {
      totalPat -= reductionGenerale;
      add("exonerations", "Réduction générale des cotisations patronales", { base: brut, tauxPatronal: r2(-coef * 100), montantPatronal: -reductionGenerale });
    }
  }

  totalSal = r2(totalSal);
  totalPat = r2(totalPat);

  // ── Nets ───────────────────────────────────────────────────────
  const netAvantImpot = r2(brut - totalSal);
  // Heures sup exonérées d'impôt dans la limite du plafond annuel : la
  // réduction salariale neutralise déjà l'essentiel des cotisations
  // déductibles qui les grèvent, on retire donc leur montant brut.
  const heuresSupExonerees = r2(Math.max(0, Math.min(montantHs, legal.heuresSup.plafondExonerationIrAnnuel - variables.cumulHeuresSupExonereesAnnee)));
  // Net imposable : le net, plus ce qui n'est pas déductible (CSG/CRDS non
  // déductibles, CSG sur HS, part patronale santé), moins les heures sup
  // exonérées d'impôt.
  const netImposable = r2(netAvantImpot + csgNonDed.ms + csgHs.ms + entreprise.mutuelle.patronal - heuresSupExonerees);
  // Montant net social : brut moins l'ensemble des cotisations et
  // contributions sociales salariales, réduction HS comprise.
  const netSocial = netAvantImpot;
  const tauxPas = salarie.tauxPas ?? tauxNeutre(legal.tauxNeutrePas, netImposable);
  const montantPas = pct(Math.max(netImposable, 0), tauxPas);

  const f = entreprise.frais;
  const frais: [string, number, number][] = [
    ["Indemnité de repas", variables.nbRepas, f.repas],
    ["Indemnité de repas unique", variables.nbRepasUnique, f.repasUnique],
    ["Indemnité de casse-croûte", variables.nbCasseCroute, f.cassecroute],
    ["Indemnité de grand déplacement", variables.nbGrandDeplacement, f.grandDeplacement],
  ];
  let fraisNonSoumis = primesNonSoumises;
  for (const [libelle, nb, unitaire] of frais) {
    if (nb > 0 && unitaire > 0) {
      const montant = r2(nb * unitaire);
      fraisNonSoumis += montant;
      add("net", libelle, { base: nb, tauxSalarial: unitaire, montantSalarial: montant, gain: true });
    }
  }
  fraisNonSoumis = r2(fraisNonSoumis);

  add("net", "Impôt sur le revenu prélevé à la source", { base: netImposable, tauxSalarial: tauxPas, montantSalarial: montantPas });

  const netAvantRetenues = r2(netAvantImpot - montantPas + fraisNonSoumis);
  const coutEmployeur = r2(brut + totalPat + fraisNonSoumis);

  // ── Acomptes, saisies, ATD… (après le net) ──────────────────────
  // Part saisissable : barème légal sur le net après cotisations et impôt,
  // hors remboursements de frais (art. L3252-2 et R3252-2 du code du travail).
  const baseSaisissable = r2(netAvantImpot - montantPas);
  const partSaisissable = partSaisissableMensuelle(baseSaisissable, variables.personnesACharge ?? 0);
  const retenues = (variables.retenues ?? []).filter((r) => r.montant > 0);
  for (const r of retenues) {
    // Acompte d'une demande : « Acompte du JJ/MM », déjà complet.
    const libelle =
      r.type === "acompte" && r.demandeId && r.libelle.trim()
        ? r.libelle.trim()
        : [LIBELLE_RETENUE[r.type], r.libelle.trim(), r.reference?.trim() ? `réf. ${r.reference.trim()}` : ""].filter(Boolean).join(" — ");
    add("net", libelle, { base: null, tauxSalarial: null, montantSalarial: r2(r.montant) });
  }
  const somme = (types: Retenue["type"][]) => r2(retenues.filter((r) => types.includes(r.type)).reduce((t, r) => t + r.montant, 0));
  const totalRetenues = somme(["acompte", "saisie", "atd", "pension", "pret", "autre"]);
  const saisies = somme(["saisie", "atd"]);
  if (saisies > partSaisissable + 0.01) {
    avertissements.push(
      `Saisies et ATD (${saisies.toFixed(2)} €) au-delà de la part saisissable du salaire (${partSaisissable.toFixed(2)} € ce mois, barème légal${variables.personnesACharge ? ` avec ${variables.personnesACharge} personne(s) à charge` : ", sans personne à charge déclarée"}). Seule la pension alimentaire peut dépasser cette part.`,
    );
  }
  const pret = somme(["pret"]);
  if (pret > pct(baseSaisissable, 10) + 0.01) {
    avertissements.push("Remboursement de prêt supérieur au dixième du salaire : la retenue pour avance de l'employeur est limitée à 10 % (art. L3251-3).");
  }
  const netAPayer = r2(netAvantRetenues - totalRetenues);
  if (netAPayer < 0) {
    avertissements.push("Les retenues dépassent le net à payer : le net versé ne peut pas être négatif.");
  }

  if (variables.heuresTravaillees !== null && variables.heuresTravaillees > SEUIL_HS_50 + 20) {
    avertissements.push("Plus de 206 h dans le mois : vérifiez les durées maximales de travail.");
  }

  return {
    lignes,
    heures: { base: heuresBase, sup25: r2(hEquiv + hSup25), sup50, absence: variables.heuresAbsenceNonPayee },
    brut,
    totalSalarial: totalSal,
    totalPatronal: totalPat,
    reductionGenerale,
    netAvantImpot,
    netSocial,
    netImposable,
    tauxPas,
    montantPas,
    fraisNonSoumis,
    netAvantRetenues,
    totalRetenues,
    partSaisissable,
    netAPayer,
    coutEmployeur,
    heuresSupExonerees,
    avertissements,
  };
}
