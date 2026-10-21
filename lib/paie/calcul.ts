import type { Bulletin, LigneBulletin, ParametresEntreprise, ParametresLegaux, ProfilSalarie, Retenue, Section, TypeRetenue, TypeTauxPas, VariablesMois } from "@/lib/paie/types";
import { partSaisissableMensuelle } from "@/lib/paie/parametres";
import { calculerArret, joursCalendaires, type CalculArret } from "@/lib/paie/arrets";
import { LIBELLE_MOTIF } from "@/lib/paie/sortie";

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
 * mois complet à l'entrée (pas de proratisation d'embauche), décompte
 * mensuel des heures (pas de décompte trimestriel conventionnel). Arrêts
 * de travail (lib/paie/arrets.ts), indemnité de congés payés (maintien ou
 * dixième) et éléments de sortie (lib/paie/sortie.ts) : voir ces modules.
 * Ce qui sort de ce périmètre se saisit en prime/retenue manuelle.
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

/** Libellé du type de taux du PAS, tel qu'il figure sur le bulletin. */
export const LIBELLE_TYPE_TAUX_PAS: Record<TypeTauxPas, string> = {
  personnalise: "Taux personnalisé",
  non_personnalise: "Taux non personnalisé",
};

/**
 * Type de taux appliqué : le choix du mois s'il est possible, sinon
 * personnalisé dès qu'un taux est saisi au profil. Sans taux saisi, seul
 * le taux non personnalisé (grille du taux neutre) s'applique.
 */
export function typeTauxPasEffectif(tauxProfil: number | null, choix?: TypeTauxPas | null): TypeTauxPas {
  if (tauxProfil === null) return "non_personnalise";
  return choix ?? "personnalise";
}

export function tauxNeutre(grille: ParametresLegaux["tauxNeutrePas"], netImposable: number): number {
  for (const tranche of grille) {
    if (tranche.jusqua === null || netImposable < tranche.jusqua) return tranche.taux;
  }
  return grille[grille.length - 1]?.taux ?? 0;
}

/**
 * Salaire mensuel du contrat (base 35 h + heures d'équivalence majorées),
 * hors heures supplémentaires : référence des absences, du maintien de
 * salaire et des indemnités de sortie.
 */
export function salaireMensuelContrat(salarie: Pick<ProfilSalarie, "tauxHoraire" | "heuresContractuelles" | "regime">): number {
  const h = salarie.heuresContractuelles;
  const equivalence = Math.max(0, Math.min(h, HEURES_EQUIVALENCE[salarie.regime]) - HEURES_LEGALES);
  return r2(r2(Math.min(h, HEURES_LEGALES) * salarie.tauxHoraire) + r2(r2(equivalence) * salarie.tauxHoraire * 1.25));
}

/** Bornes d'un mois "AAAA-MM" (fin incluse). */
function bornes(mois: string): { debut: string; fin: string } {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  return { debut: `${mois}-01`, fin: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

export function calculerBulletin({
  legal,
  entreprise,
  salarie,
  variables,
  periode: periodeDonnee,
}: {
  legal: ParametresLegaux;
  entreprise: ParametresEntreprise;
  salarie: ProfilSalarie;
  variables: VariablesMois;
  /** Bornes du mois du bulletin ; nécessaires aux arrêts et à la sortie (sinon déduites des dates saisies). */
  periode?: { debut: string; fin: string };
}): Bulletin {
  const lignes: LigneBulletin[] = [];
  const avertissements: string[] = [];
  const add = (section: Section, libelle: string, l: Partial<LigneBulletin>) =>
    lignes.push({ section, libelle, base: null, tauxSalarial: null, montantSalarial: null, tauxPatronal: null, montantPatronal: null, ...l });

  // ── Heures et brut ─────────────────────────────────────────────
  // Mensualisation : le contrat est payé même si le mois réel est plus
  // court (les absences se déclarent à part) ; les heures en plus du
  // contrat s'ajoutent.
  // Heures supplémentaires saisies (modèle transport) : elles s'ajoutent
  // aux heures du contrat et remplacent celles déduites des heures travaillées.
  const hsSaisies = (variables.heuresSup25 ?? null) !== null || (variables.heuresSup50 ?? null) !== null;
  const heuresPayees = hsSaisies ? salarie.heuresContractuelles : Math.max(salarie.heuresContractuelles, variables.heuresTravaillees ?? 0);
  const heuresBase = Math.min(heuresPayees, HEURES_LEGALES);
  const equivalence = HEURES_EQUIVALENCE[salarie.regime];
  const sup25 = r2(Math.max(0, Math.min(heuresPayees, SEUIL_HS_50) - HEURES_LEGALES) + (hsSaisies ? Math.max(0, variables.heuresSup25 ?? 0) : 0));
  const sup50 = r2(Math.max(0, heuresPayees - SEUIL_HS_50) + (hsSaisies ? Math.max(0, variables.heuresSup50 ?? 0) : 0));
  const t = salarie.tauxHoraire;

  if (salarie.tauxHoraire < legal.smicHoraire) {
    avertissements.push(`Taux horaire inférieur au SMIC (${legal.smicHoraire.toFixed(2)} €).`);
  }

  const montantBase = r2(heuresBase * t);
  add("brut", "Salaire de base", { base: heuresBase, tauxSalarial: t, montantSalarial: montantBase, gain: true });

  // Heures entre 35 h et la durée d'équivalence (conducteurs) puis au-delà.
  const hEquiv = r2(Math.max(0, Math.min(sup25, Math.min(heuresPayees, equivalence) - HEURES_LEGALES)));
  const hSup25 = r2(sup25 - hEquiv);
  const montantEquiv = r2(hEquiv * t * 1.25);
  const montantSup25 = r2(hSup25 * t * 1.25);
  const montantSup50 = r2(sup50 * t * 1.5);
  if (hEquiv > 0) add("brut", "Heures d'équivalence majorées 25 %", { base: hEquiv, tauxSalarial: r2(t * 1.25), montantSalarial: montantEquiv, gain: true });
  if (hSup25 > 0) add("brut", "Heures supplémentaires 25 %", { base: hSup25, tauxSalarial: r2(t * 1.25), montantSalarial: montantSup25, gain: true });
  if (sup50 > 0) add("brut", "Heures supplémentaires 50 %", { base: sup50, tauxSalarial: r2(t * 1.5), montantSalarial: montantSup50, gain: true });

  const absence = r2(variables.heuresAbsenceNonPayee * t);
  if (absence > 0) add("brut", "Absence non rémunérée", { base: variables.heuresAbsenceNonPayee, tauxSalarial: t, montantSalarial: -absence, gain: true });

  // Congés payés pris (maintien de salaire) : absence en jours ouvrables
  // au 1/26 du salaire de base, compensée par l'indemnité de congés payés.
  const periodes = (variables.periodesConges ?? []).filter((p) => p.jours > 0);
  const joursCp = periodes.length ? r2(periodes.reduce((t, p) => t + p.jours, 0)) : variables.joursCongesPris;
  let complementCp = 0;
  let indemniteCp: Bulletin["indemniteCp"] = null;
  if (joursCp > 0) {
    const parJour = r2(montantBase / 26);
    const fmt = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(2, 4)}`;
    const libelles = periodes.length
      ? periodes.map((p) => ({ jours: p.jours, texte: `Congés payés pris ${fmt(p.du)}-${fmt(p.au)} (${p.jours} jour${p.jours > 1 ? "s" : ""})` }))
      : [{ jours: joursCp, texte: `Congés payés pris (${joursCp} jour${joursCp > 1 ? "s" : ""})` }];
    for (const l of libelles) add("brut", l.texte, { base: l.jours, tauxSalarial: parJour, montantSalarial: -r2(l.jours * parJour), gain: true });
    // Indemnité : la plus favorable entre le maintien de salaire et le
    // dixième de la rémunération brute de la période de référence, au
    // prorata des jours pris (art. L3141-24).
    const maintienCp = r2(joursCp * parJour);
    const ref = variables.cpReference;
    const dixieme = ref && ref.brut > 0 && ref.joursAcquis > 0 ? r2((ref.brut * 0.1 * joursCp) / ref.joursAcquis) : null;
    if (dixieme !== null && dixieme > maintienCp) {
      complementCp = r2(dixieme - maintienCp);
      indemniteCp = { jours: joursCp, maintien: maintienCp, dixieme, retenue: "dixieme" };
      add("brut", "Indemnité congés payés (règle du dixième)", {
        base: joursCp,
        tauxSalarial: r2(dixieme / joursCp),
        montantSalarial: dixieme,
        gain: true,
        mention: `plus favorable que le maintien (${maintienCp.toFixed(2).replace(".", ",")} €)`,
      });
    } else {
      indemniteCp = { jours: joursCp, maintien: maintienCp, dixieme, retenue: "maintien" };
      add("brut", "Indemnité congés payés", {
        base: joursCp,
        tauxSalarial: parJour,
        montantSalarial: maintienCp,
        gain: true,
        mention: dixieme !== null ? `maintien, plus favorable que le dixième (${dixieme.toFixed(2).replace(".", ",")} €)` : "maintien de salaire (pas de cumuls validés sur la période de référence)",
      });
    }
  }

  // ── Arrêts de travail, congés sans solde, sortie en cours de mois ──
  // Méthode des jours calendaires réels sur le salaire du contrat (base +
  // heures d'équivalence), voir lib/paie/arrets.ts.
  const premiereDate = variables.sortie?.date ?? (variables.arrets ?? [])[0]?.du ?? variables.datePaiement ?? null;
  const periode = periodeDonnee ?? (premiereDate ? bornes(premiereDate.slice(0, 7)) : null);
  const salaireReference = r2(montantBase + r2(Math.max(0, Math.min(heuresPayees, equivalence) - HEURES_LEGALES) * t * 1.25));
  const subrogation = variables.subrogation ?? entreprise.subrogation ?? false;
  const calculsArrets: CalculArret[] = [];
  let absenceArrets = 0;
  let maintienArrets = 0;
  let ijssBrutes = 0;
  let ijssMoitie = 0;
  if (periode) {
    for (const a of (variables.arrets ?? []).filter((x) => x.du && x.au && x.au >= x.du && x.du <= periode.fin && x.au >= periode.debut)) {
      const c = calculerArret({ arret: a, debutMois: periode.debut, finMois: periode.fin, salaireMensuel: salaireReference, dateEntree: salarie.dateEntree, maintienConventionnel: entreprise.maintien, legal });
      if (c.jours <= 0) continue;
      calculsArrets.push(c);
      avertissements.push(...c.avertissements);
    }
  }
  for (const c of calculsArrets) {
    // Pas plus que le salaire de référence du mois, même avec des arrêts qui se chevauchent.
    const deduction = r2(Math.min(c.deduction, salaireReference - absenceArrets));
    absenceArrets = r2(absenceArrets + deduction);
    add("brut", c.libelle, { base: c.jours, tauxSalarial: c.salaireJour, montantSalarial: -deduction, gain: true, mention: "jours calendaires" });
    if (subrogation && c.ijssBrutes > 0) {
      ijssBrutes = r2(ijssBrutes + c.ijssBrutes);
      if (c.ijssMoitieImposable) ijssMoitie = r2(ijssMoitie + c.ijssBrutes);
      add("brut", "IJSS brutes", { base: c.joursIjss, tauxSalarial: r2(c.ijssBrutes / Math.max(c.joursIjss, 1)), montantSalarial: c.ijssBrutes, gain: true, mention: "subrogation, non soumises à cotisations" });
    }
    if (c.maintien > 0 || c.mention) {
      maintienArrets = r2(maintienArrets + c.maintien);
      add("brut", "Maintien de salaire", { base: null, tauxSalarial: null, montantSalarial: c.maintien, gain: true, mention: `${c.mention}${subrogation || !c.ijssBrutes ? "" : " — IJSS versées directement par la CPAM"}` });
    }
  }
  if (calculsArrets.some((c) => c.maintien > 0 && !c.mention.startsWith("maintien saisi"))) {
    avertissements.push("Maintien de salaire : durées appréciées arrêt par arrêt ; vérifiez le cumul des arrêts des 12 derniers mois (art. D1226-4).");
  }

  // Sortie en cours de mois : jours après la date de sortie retirés, puis
  // indemnités de fin de contrat.
  const sortie = variables.sortie ?? null;
  let absenceSortie = 0;
  let indemnitesSortieSoumises = 0;
  let ruptureExoneree = 0;
  if (sortie && periode && sortie.date >= periode.debut && sortie.date < periode.fin) {
    const lendemain = new Date(Date.parse(`${sortie.date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const jours = joursCalendaires(lendemain, periode.fin);
    absenceSortie = r2(Math.min(Math.max(0, salaireReference - absenceArrets), (salaireReference * jours) / joursCalendaires(periode.debut, periode.fin)));
    if (absenceSortie > 0) add("brut", `Sortie le ${sortie.date.slice(8, 10)}/${sortie.date.slice(5, 7)} : jours non travaillés`, { base: jours, tauxSalarial: r2(salaireReference / joursCalendaires(periode.debut, periode.fin)), montantSalarial: -absenceSortie, gain: true, mention: "jours calendaires" });
  }
  if (sortie) {
    if (sortie.iccp && sortie.iccp.montant > 0) {
      indemnitesSortieSoumises += sortie.iccp.montant;
      add("brut", `Indemnité compensatrice de congés payés (${sortie.iccp.jours} j)`, { base: sortie.iccp.jours, montantSalarial: r2(sortie.iccp.montant), gain: true, mention: sortie.iccp.methode === "dixieme" ? "règle du dixième" : "maintien de salaire" });
    }
    if (sortie.preavis && sortie.preavis.montant > 0) {
      indemnitesSortieSoumises += sortie.preavis.montant;
      add("brut", "Indemnité compensatrice de préavis", { base: sortie.preavis.jours, montantSalarial: r2(sortie.preavis.montant), gain: true });
    }
    if (sortie.rupture && sortie.rupture.montant > 0) {
      const soumise = r2(sortie.rupture.montant - sortie.rupture.exonereeSocial);
      ruptureExoneree = sortie.rupture.exonereeSocial;
      if (soumise > 0) {
        indemnitesSortieSoumises += soumise;
        add("brut", `${sortie.rupture.libelle} (part soumise)`, { montantSalarial: soumise, gain: true, mention: LIBELLE_MOTIF[sortie.motif] });
      }
    }
    indemnitesSortieSoumises = r2(indemnitesSortieSoumises);
  }

  let primesSoumises = 0;
  let primesNonSoumises = 0;
  for (const p of variables.primes) {
    if (!p.montant) continue;
    add("brut", p.libelle || "Prime", { montantSalarial: r2(p.montant), gain: true });
    if (p.soumise) primesSoumises += p.montant;
    else primesNonSoumises += p.montant;
  }

  const montantHs = r2(montantEquiv + montantSup25 + montantSup50);
  // Brut soumis à cotisations ; les IJSS reprises en subrogation s'y
  // ajoutent pour le brut affiché, hors assiette des cotisations.
  const brut = r2(montantBase + montantHs - absence + primesSoumises + complementCp - absenceArrets + maintienArrets - absenceSortie + indemnitesSortieSoumises);

  // ── DFS « Abattement 17 % » ──────────────────────────────────────
  // Affichée pour mémoire ; appliquée aux bases de cotisations (hors
  // CSG/CRDS) seulement si l'entreprise l'a activée.
  const dfs = entreprise.dfs && entreprise.dfs.taux > 0 ? { taux: entreprise.dfs.taux, montant: pct(brut, entreprise.dfs.taux), appliquee: entreprise.dfs.active } : null;
  if (dfs) add("brut", `Abattement ${String(dfs.taux).replace(".", ",")} % (DFS)${dfs.appliquee ? "" : " — pour mémoire"}`, { base: brut, tauxSalarial: dfs.taux, montantSalarial: null });
  const baseCot = dfs?.appliquee ? r2(brut - dfs.montant) : brut;

  // ── Assiettes ──────────────────────────────────────────────────
  const pmss = legal.pmss;
  const t1 = Math.min(baseCot, pmss);
  const t2 = Math.max(0, Math.min(baseCot, 8 * pmss) - pmss);
  const smicMensuel = legal.smicHoraire * HEURES_LEGALES;
  // SMIC de référence de la réduction générale (RGDU) : SMIC de la
  // formule × durée légale, porté à 45/35 (grands routiers) ou 40/35
  // (courte distance) pour les conducteurs en régime d'équivalence
  // (art. D241-10 CSS), diminué des absences non payées.
  const facteurEquivalence = salarie.regime === "grand_routier" ? 45 / 35 : salarie.regime === "courte_distance" ? 40 / 35 : 1;
  // Le SMIC de référence est majoré des heures supplémentaires payées, sans
  // leur majoration (art. D241-7 CSS) ; les heures d'équivalence sont déjà
  // couvertes par le facteur ci-dessus.
  // Arrêts et sortie en cours de mois : SMIC de référence réduit dans le
  // rapport rémunération versée / rémunération sans absence (simplifié).
  const partNonPayee = salaireReference > 0 ? Math.min(1, Math.max(0, (absenceArrets - maintienArrets + absenceSortie) / salaireReference)) : 0;
  const smicRef =
    legal.reductionGenerale.smicHoraireReference * Math.max(HEURES_LEGALES * facteurEquivalence + hSup25 + sup50 - variables.heuresAbsenceNonPayee, 0) * (1 - partNonPayee);
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
  const maladie = cot("sante", "Sécurité sociale — maladie, maternité, invalidité, décès", baseCot, null, maladieTaux);
  const prevoyanceTaux = salarie.cadre ? { salarial: entreprise.prevoyance.salarial, patronal: Math.max(entreprise.prevoyance.patronal, legal.prevoyanceCadreMinT1) } : entreprise.prevoyance;
  let prevoyancePatronale = 0;
  if (prevoyanceTaux.salarial || prevoyanceTaux.patronal) {
    prevoyancePatronale = cot("sante", salarie.cadre ? "Prévoyance cadre" : "Prévoyance conventionnelle", t1, prevoyanceTaux.salarial, prevoyanceTaux.patronal).mp;
  }
  // Complémentaire santé : au forfait sur le PMSS (modèle transport) ou en montants fixes.
  const sante = entreprise.santePmss && (entreprise.santePmss.salarial || entreprise.santePmss.patronal)
    ? { salarial: pct(pmss, entreprise.santePmss.salarial), patronal: pct(pmss, entreprise.santePmss.patronal), taux: entreprise.santePmss }
    : { salarial: r2(entreprise.mutuelle.salarial), patronal: r2(entreprise.mutuelle.patronal), taux: null };
  if (sante.salarial || sante.patronal) {
    totalSal += sante.salarial;
    totalPat += sante.patronal;
    add("sante", "Complémentaire santé", {
      base: sante.taux ? pmss : null,
      tauxSalarial: sante.taux?.salarial ?? null,
      montantSalarial: sante.salarial,
      tauxPatronal: sante.taux?.patronal ?? null,
      montantPatronal: sante.patronal,
    });
  }

  // ── Accidents du travail & maladies professionnelles ──
  // Rubrique à part entière du bulletin clarifié, entre Santé et Retraite.
  const at = cot("at", "Accidents du travail & maladies professionnelles", baseCot, null, entreprise.tauxAccidentTravail);

  // ── Retraite ──
  const vp = cot("retraite", "Sécurité sociale plafonnée", t1, legal.vieillessePlafonnee.salarial, legal.vieillessePlafonnee.patronal);
  const vd = cot("retraite", "Sécurité sociale déplafonnée", baseCot, legal.vieillesseDeplafonnee.salarial, legal.vieillesseDeplafonnee.patronal);
  const aa1 = cot("retraite", "Complémentaire Agirc-Arrco tranche 1", t1, legal.agircArrcoT1.salarial, legal.agircArrcoT1.patronal);
  const ceg1 = cot("retraite", "Contribution d'équilibre général T1", t1, legal.cegT1.salarial, legal.cegT1.patronal);
  let salRetraiteT2 = 0;
  if (t2 > 0) {
    salRetraiteT2 += cot("retraite", "Complémentaire Agirc-Arrco tranche 2", t2, legal.agircArrcoT2.salarial, legal.agircArrcoT2.patronal).ms;
    salRetraiteT2 += cot("retraite", "Contribution d'équilibre général T2", t2, legal.cegT2.salarial, legal.cegT2.patronal).ms;
    salRetraiteT2 += cot("retraite", "Contribution d'équilibre technique", t1 + t2, legal.cet.salarial, legal.cet.patronal).ms;
  }
  if (salarie.cadre) cot("retraite", "APEC", Math.min(baseCot, 4 * pmss), legal.apec.salarial, legal.apec.patronal);

  // ── Famille ──
  const afTaux = brut <= legal.allocationsFamiliales.seuilReduitSmic * smicMensuel ? legal.allocationsFamiliales.reduit : legal.allocationsFamiliales.normal;
  const af = cot("famille", "Allocations familiales", baseCot, null, afTaux);

  // ── Chômage ──
  const chomage = cot("chomage", "Assurance chômage", Math.min(baseCot, 4 * pmss), null, legal.chomage);
  cot("chomage", "AGS", Math.min(baseCot, 4 * pmss), null, legal.ags);

  // ── Autres contributions employeur ──
  const fnal50 = entreprise.effectif >= 50;
  const fnal = cot("autres", "FNAL", fnal50 ? baseCot : t1, null, fnal50 ? legal.fnal.auMoins50 : legal.fnal.moins50);
  const csa = cot("autres", "Contribution solidarité autonomie", baseCot, null, legal.csa);
  cot("autres", "Contribution au dialogue social", baseCot, null, legal.dialogueSocial);
  cot("autres", "Formation professionnelle", baseCot, null, entreprise.effectif >= 11 ? legal.formationPro.auMoins11 : legal.formationPro.moins11);
  cot("autres", "Taxe d'apprentissage", baseCot, null, legal.taxeApprentissage);
  if (entreprise.conventionnelles && (entreprise.conventionnelles.salarial || entreprise.conventionnelles.patronal)) {
    cot("autres", "Cotisations conventionnelles (CCN)", baseCot, entreprise.conventionnelles.salarial, entreprise.conventionnelles.patronal);
  }
  if (entreprise.effectif >= 11 && entreprise.tauxVersementMobilite > 0) cot("autres", "Versement mobilité", baseCot, null, entreprise.tauxVersementMobilite);
  if (sortie?.rupture && sortie.rupture.contributionPatronale > 0 && sortie.rupture.exonereeSocial > 0) {
    cot("autres", "Contribution patronale sur indemnité de rupture conventionnelle", sortie.rupture.exonereeSocial, null, sortie.rupture.contributionPatronale);
  }

  // ── CSG / CRDS ──
  // Assiette : 98,25 % du brut (dans la limite de 4 PMSS) + part patronale
  // de prévoyance et de complémentaire santé, à 100 %.
  const brutHorsHs = brut - montantHs;
  const abattu = (x: number) => Math.min(x, 4 * pmss) * (legal.assietteCsgPart / 100) + Math.max(0, x - 4 * pmss);
  const assietteCsg = r2(abattu(brut) + prevoyancePatronale + sante.patronal);
  // La CSG sur la part « heures sup » est entièrement non déductible.
  const assietteCsgHs = r2(abattu(brut) - abattu(brutHorsHs));
  const csgDed = cot("csg", "CSG déductible de l'impôt sur le revenu", assietteCsg - assietteCsgHs, legal.csgDeductible, null);
  const csgNonDed = cot("csg", "CSG/CRDS non déductible de l'impôt sur le revenu", assietteCsg, legal.csgNonDeductible + legal.crds, null);
  let csgHs = { ms: 0, mp: 0 };
  if (assietteCsgHs > 0) csgHs = cot("csg", "CSG non déductible sur heures supplémentaires", assietteCsgHs, legal.csgDeductible, null);
  // IJSS reprises en subrogation : CSG / CRDS des revenus de remplacement.
  const tIj = legal.ijss ?? { csgDeductible: 3.8, csgNonDeductible: 2.4, crds: 0.5 };
  let csgIjDed = { ms: 0, mp: 0 };
  let csgIjNonDed = { ms: 0, mp: 0 };
  if (ijssBrutes > 0) {
    csgIjDed = cot("csg", "CSG déductible sur IJSS", ijssBrutes, tIj.csgDeductible, null);
    csgIjNonDed = cot("csg", "CSG/CRDS non déductible sur IJSS", ijssBrutes, tIj.csgNonDeductible + tIj.crds, null);
  }
  // Indemnité de rupture : CSG / CRDS sur la part au-delà de l'indemnité
  // légale qui n'est pas déjà dans le brut soumis (simplifié, sans abattement).
  let csgRuptureNonDed = { ms: 0, mp: 0 };
  if (sortie?.rupture) {
    const base = r2(Math.max(0, sortie.rupture.baseCsg - (sortie.rupture.montant - sortie.rupture.exonereeSocial)));
    if (base > 0) {
      cot("csg", "CSG déductible sur indemnité de rupture", base, legal.csgDeductible, null);
      csgRuptureNonDed = cot("csg", "CSG/CRDS non déductible sur indemnité de rupture", base, legal.csgNonDeductible + legal.crds, null);
    }
  }

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
  let deductionHs = 0;
  if (nbHs > 0 && eligibleRgdu) {
    const parHeure = entreprise.effectif < 20 ? legal.heuresSup.deductionPatronaleParHeure.moins20 : legal.heuresSup.deductionPatronaleParHeure.de20a249;
    const deduction = r2(nbHs * parHeure);
    deductionHs = deduction;
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
  const totalPatronalHorsReduction = r2(totalPat + reductionGenerale + deductionHs);

  // ── Nets ───────────────────────────────────────────────────────
  const brutAffiche = r2(brut + ijssBrutes);
  const netAvantImpot = r2(brutAffiche - totalSal);
  // Heures sup exonérées d'impôt dans la limite du plafond annuel : la
  // réduction salariale neutralise déjà l'essentiel des cotisations
  // déductibles qui les grèvent, on retire donc leur montant brut.
  const heuresSupExonerees = r2(Math.max(0, Math.min(montantHs, legal.heuresSup.plafondExonerationIrAnnuel - variables.cumulHeuresSupExonereesAnnee)));
  // Net imposable : le net, plus ce qui n'est pas déductible (CSG/CRDS non
  // déductibles, CSG sur HS, part patronale santé), moins les heures sup
  // exonérées d'impôt.
  // Réintégration fiscale : part employeur de la complémentaire santé.
  const reintegrationSante = sante.patronal;
  // IJSS (subrogation) : imposables après CSG déductible, à 50 % pour un
  // AT / maladie professionnelle ou un accident de trajet. Indemnité de
  // rupture : la part soumise à cotisations mais exonérée d'impôt est retirée.
  const ijssNonImposables = ijssMoitie > 0 ? r2((ijssMoitie * (1 - tIj.csgDeductible / 100)) / 2) : 0;
  const ruptureNonImposable = sortie?.rupture ? r2(Math.max(0, sortie.rupture.exonereeFiscal - sortie.rupture.exonereeSocial)) : 0;
  const netImposable = r2(netAvantImpot + csgNonDed.ms + csgHs.ms + csgIjNonDed.ms + csgRuptureNonDed.ms + reintegrationSante - heuresSupExonerees - ijssNonImposables - ruptureNonImposable);
  // Montant net social : brut moins l'ensemble des cotisations et
  // contributions sociales salariales, réduction HS comprise ; hors IJSS
  // (revenus de remplacement).
  const ijssReversees = r2(ijssBrutes - csgIjDed.ms - csgIjNonDed.ms);
  const netSocial = r2(netAvantImpot - ijssReversees);
  const typeTauxPas = typeTauxPasEffectif(salarie.tauxPas, variables.typeTauxPas);
  const tauxPas = typeTauxPas === "personnalise" ? (salarie.tauxPas ?? 0) : tauxNeutre(legal.tauxNeutrePas, netImposable);
  const montantPas = pct(Math.max(netImposable, 0), tauxPas);

  const f = entreprise.frais;
  const frais: [string, number, number][] = [
    ["Indemnité de repas", variables.nbRepas, variables.tauxRepas ?? salarie.tauxRepas ?? f.repas],
    ["Indemnité de repas unique", variables.nbRepasUnique, f.repasUnique],
    ["Indemnité de casse-croûte", variables.nbCasseCroute, f.cassecroute],
    ["Indemnité de grand déplacement", variables.nbGrandDeplacement, f.grandDeplacement],
  ];
  let fraisNonSoumis = primesNonSoumises;
  if (ruptureExoneree > 0 && sortie?.rupture) {
    fraisNonSoumis += ruptureExoneree;
    add("net", `${sortie.rupture.libelle} (part exonérée)`, { montantSalarial: r2(ruptureExoneree), gain: true, mention: "non soumise à cotisations" });
  }
  if (ijssBrutes > 0) {
    // Pour information : les IJSS nettes sont comprises dans le net ci-dessus.
    add("net", "IJSS nettes", { base: ijssReversees, mention: "reversées par l'employeur (subrogation), comprises dans le net" });
  }
  for (const [libelle, nb, unitaire] of frais) {
    if (nb > 0 && unitaire > 0) {
      const montant = r2(nb * unitaire);
      fraisNonSoumis += montant;
      add("net", libelle, { base: nb, tauxSalarial: unitaire, montantSalarial: montant, gain: true });
    }
  }
  fraisNonSoumis = r2(fraisNonSoumis);

  add("net", "Impôt sur le revenu prélevé à la source", { base: netImposable, tauxSalarial: tauxPas, montantSalarial: montantPas, mention: LIBELLE_TYPE_TAUX_PAS[typeTauxPas] });

  const netAvantRetenues = r2(netAvantImpot - montantPas + fraisNonSoumis);
  // Coût employeur hors IJSS (remboursées par la CPAM en subrogation).
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
    brut: brutAffiche,
    totalSalarial: totalSal,
    totalPatronal: totalPat,
    reductionGenerale,
    netAvantImpot,
    netSocial,
    netImposable,
    tauxPas,
    typeTauxPas,
    montantPas,
    fraisNonSoumis,
    netAvantRetenues,
    totalRetenues,
    partSaisissable,
    netAPayer,
    coutEmployeur,
    heuresSupExonerees,
    totalDu: r2(netAvantImpot + fraisNonSoumis),
    assietteCsg,
    reintegrationSante,
    dfs,
    totalPatronalHorsReduction,
    ijssBrutes: ijssBrutes || undefined,
    ijssNettes: ijssBrutes ? ijssReversees : undefined,
    indemniteCp,
    avertissements,
  };
}
