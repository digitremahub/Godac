// Export pour le comptable (Équipe › Paie › Export) : le mois au format
// CSV français, en version complète (bulletins calculés par GODAC) ou
// « éléments variables » (entrées brutes du mois, pour un comptable qui
// refait la paie dans son logiciel), et les contrôles affichés avant
// l'export. GODAC ne produit pas de DSN : le comptable la dépose.
// Fichier pur, testé dans lib/paie/__tests__/export-comptable.test.ts.

import { dateFr, documentCsv, type Cellule } from "@/lib/paie/csv";
import { fraisDuBulletin, RUBRIQUES, ventiler } from "@/lib/paie/journal";
import { LIBELLES_VALIDATION, statutValide } from "@/lib/paie/validation";
import type { Bulletin, Prime, Retenue, VariablesMois } from "@/lib/paie/types";

export interface SalarieExport {
  id: string;
  nom: string;
  emploi: string | null;
  matricule: string | null;
  coefficient: string | null;
  actif: boolean;
  /** Le salarié s'est opposé à la remise électronique (art. L3243-2). */
  papierDemande?: boolean;
}

export interface BulletinExport {
  id: string;
  user_id: string;
  validation_status: string | null;
  gross_amount: number | string | null;
  net_amount: number | string | null;
  /** Bulletin calculé par le moteur ; null pour un ancien bulletin indicatif. */
  details: Bulletin | null;
  variables: VariablesMois | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const TYPES_SAISIE = new Set<Retenue["type"]>(["saisie", "atd", "pension"]);

const MODES: Record<string, string> = { virement: "Virement", cheque: "Chèque", especes: "Espèces" };
const TYPES_PAS: Record<string, string> = { personnalise: "Personnalisé", non_personnalise: "Non personnalisé (grille)" };

/** « Prime de nuit : 120,00 (soumise) | Indemnité X : 30,00 (non soumise) ». */
export function detailPrimes(primes: readonly Prime[] | undefined): string {
  return (primes ?? [])
    .filter((p) => p.montant)
    .map((p) => `${p.libelle || "Prime"} : ${p.montant.toFixed(2).replace(".", ",")} (${p.soumise ? "soumise" : "non soumise"})`)
    .join(" | ");
}

export function detailRetenues(retenues: readonly Retenue[] | undefined, filtre: (r: Retenue) => boolean): string {
  return (retenues ?? [])
    .filter((r) => r.montant > 0 && filtre(r))
    .map((r) => `${r.libelle} : ${r.montant.toFixed(2).replace(".", ",")}${r.reference ? ` (réf. ${r.reference})` : ""}`)
    .join(" | ");
}

const somme = (retenues: readonly Retenue[] | undefined, filtre: (r: Retenue) => boolean) => r2((retenues ?? []).filter((r) => r.montant > 0 && filtre(r)).reduce((t, r) => t + r.montant, 0));

export function joursConges(v: VariablesMois | null): number {
  if (!v) return 0;
  return v.periodesConges?.length ? v.periodesConges.reduce((t, p) => t + p.jours, 0) : v.joursCongesPris;
}

function statutBulletin(b: BulletinExport | undefined): string {
  if (!b) return "Sans bulletin";
  if (!b.details) return "Bulletin indicatif (hors moteur)";
  return LIBELLES_VALIDATION[statutValide(b.validation_status)];
}

// ── Export complet ─────────────────────────────────────────────────

export const ENTETE_COMPLET: readonly string[] = [
  "Mois",
  "Matricule",
  "Nom",
  "Emploi",
  "Coefficient",
  "Statut du bulletin",
  "Heures de base",
  "Heures sup. 25 %",
  "Heures sup. 50 %",
  "Heures d'absence",
  "Jours de CP pris",
  "Paniers repas (nb)",
  "Repas uniques (nb)",
  "Casse-croûte (nb)",
  "Grands déplacements (nb)",
  "Indemnités de frais et primes non soumises",
  "Primes (détail)",
  "Primes soumises",
  "Primes non soumises",
  "Brut",
  ...RUBRIQUES.flatMap((r) => [`${r.libelle} salarial`, `${r.libelle} patronal`]),
  "Réduction générale",
  "Total cotisations salariales",
  "Total cotisations patronales",
  "Net social",
  "Net imposable",
  "Taux PAS (%)",
  "Type de taux PAS",
  "Montant PAS",
  "Acomptes",
  "Saisies, ATD, pensions",
  "Autres retenues",
  "Net payé",
  "Date de paiement",
  "Mode de paiement",
  "Coût employeur",
  "Bulletin papier demandé",
];

export function ligneComplete(mois: string, s: SalarieExport, b: BulletinExport | undefined): Cellule[] {
  const ident: Cellule[] = [mois, s.matricule, s.nom, s.emploi, s.coefficient, statutBulletin(b)];
  const d = b?.details;
  const v = b?.variables ?? null;
  if (!d) {
    // Sans bulletin calculé : identité, statut et montants enregistrés seulement.
    const vides = ENTETE_COMPLET.length - ident.length - 1;
    const cellules: Cellule[] = [...ident, ...Array<Cellule>(vides).fill(null), s.papierDemande ?? false];
    if (b) {
      cellules[ENTETE_COMPLET.indexOf("Brut")] = Number(b.gross_amount ?? 0);
      cellules[ENTETE_COMPLET.indexOf("Net payé")] = Number(b.net_amount ?? 0);
    }
    return cellules;
  }
  const vent = ventiler(d);
  const primes = v?.primes ?? [];
  const retenues = v?.retenues ?? [];
  return [
    ...ident,
    d.heures.base,
    d.heures.sup25,
    d.heures.sup50,
    d.heures.absence,
    joursConges(v),
    v?.nbRepas ?? 0,
    v?.nbRepasUnique ?? 0,
    v?.nbCasseCroute ?? 0,
    v?.nbGrandDeplacement ?? 0,
    fraisDuBulletin(d),
    detailPrimes(primes),
    r2(primes.filter((p) => p.soumise).reduce((t, p) => t + p.montant, 0)),
    r2(primes.filter((p) => !p.soumise).reduce((t, p) => t + p.montant, 0)),
    d.brut,
    ...RUBRIQUES.flatMap((r) => [vent[r.id].salarial, vent[r.id].patronal]),
    d.reductionGenerale ?? 0,
    d.totalSalarial,
    d.totalPatronal,
    d.netSocial,
    d.netImposable,
    d.tauxPas,
    TYPES_PAS[d.typeTauxPas ?? v?.typeTauxPas ?? ""] ?? "",
    d.montantPas,
    somme(retenues, (r) => r.type === "acompte"),
    somme(retenues, (r) => TYPES_SAISIE.has(r.type)),
    somme(retenues, (r) => r.type !== "acompte" && !TYPES_SAISIE.has(r.type)),
    d.netAPayer,
    dateFr(v?.datePaiement ?? null),
    MODES[v?.modePaiement ?? "virement"] ?? "",
    d.coutEmployeur,
    s.papierDemande ?? false,
  ];
}

// ── Éléments variables ─────────────────────────────────────────────

export const ENTETE_VARIABLES: readonly string[] = [
  "Mois",
  "Matricule",
  "Nom",
  "Emploi",
  "Coefficient",
  "Source",
  "Heures travaillées",
  "Heures sup. 25 %",
  "Heures sup. 50 %",
  "Heures d'absence non payée",
  "Jours de CP pris",
  "Périodes de CP",
  "Paniers repas (nb)",
  "Taux du panier",
  "Repas uniques (nb)",
  "Casse-croûte (nb)",
  "Grands déplacements (nb)",
  "Primes (détail)",
  "Acomptes",
  "Saisies, ATD, pensions (détail)",
  "Saisies, ATD, pensions (total)",
  "Autres retenues (détail)",
  "Personnes à charge",
  "Date de paiement",
  "Mode de paiement",
];

/**
 * `source` : « Bulletin GODAC (statut) » quand les variables viennent
 * d'un bulletin, « Préremplissage GODAC (à vérifier) » quand elles sont
 * reprises des tournées et des congés sans bulletin.
 */
export function ligneVariables(mois: string, s: SalarieExport, v: VariablesMois | null, source: string): Cellule[] {
  const ident: Cellule[] = [mois, s.matricule, s.nom, s.emploi, s.coefficient, source];
  if (!v) return [...ident, ...Array<Cellule>(ENTETE_VARIABLES.length - ident.length).fill(null)];
  const retenues = v.retenues ?? [];
  return [
    ...ident,
    v.heuresTravaillees,
    v.heuresSup25 ?? null,
    v.heuresSup50 ?? null,
    v.heuresAbsenceNonPayee,
    joursConges(v),
    (v.periodesConges ?? []).map((p) => `${dateFr(p.du)} au ${dateFr(p.au)} (${p.jours} j)`).join(" | "),
    v.nbRepas,
    v.tauxRepas ?? null,
    v.nbRepasUnique,
    v.nbCasseCroute,
    v.nbGrandDeplacement,
    detailPrimes(v.primes),
    somme(retenues, (r) => r.type === "acompte"),
    detailRetenues(retenues, (r) => TYPES_SAISIE.has(r.type)),
    somme(retenues, (r) => TYPES_SAISIE.has(r.type)),
    detailRetenues(retenues, (r) => r.type !== "acompte" && !TYPES_SAISIE.has(r.type)),
    v.personnesACharge ?? 0,
    dateFr(v.datePaiement ?? null),
    MODES[v.modePaiement ?? "virement"] ?? "",
  ];
}

// ── Assemblage ─────────────────────────────────────────────────────

/** Salariés de l'export : actifs, plus les inactifs qui ont un bulletin ce mois. Tri par nom. */
export function salariesDuMois(salaries: readonly SalarieExport[], bulletins: readonly BulletinExport[]): SalarieExport[] {
  const avecBulletin = new Set(bulletins.map((b) => b.user_id));
  return salaries.filter((s) => s.actif || avecBulletin.has(s.id)).sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
}

export function csvComplet(mois: string, salaries: readonly SalarieExport[], bulletins: readonly BulletinExport[]): string {
  const de = new Map(bulletins.map((b) => [b.user_id, b]));
  return documentCsv(
    ENTETE_COMPLET,
    salariesDuMois(salaries, bulletins).map((s) => ligneComplete(mois, s, de.get(s.id))),
  );
}

export function csvVariables(mois: string, lignes: readonly { salarie: SalarieExport; variables: VariablesMois | null; source: string }[]): string {
  return documentCsv(
    ENTETE_VARIABLES,
    lignes.map((l) => ligneVariables(mois, l.salarie, l.variables, l.source)),
  );
}

// ── Contrôles avant export ─────────────────────────────────────────

export interface Controle {
  niveau: "avertissement" | "info";
  message: string;
  salaries: string[];
}

const ECART = 0.02;

/**
 * Contrôles du mois, affichés avant l'export sans le bloquer : bulletins
 * non validés, salariés actifs sans bulletin, bulletins indicatifs hors
 * moteur, et écarts (ventilation des cotisations ≠ totaux, montants
 * enregistrés ≠ bulletin calculé, net négatif).
 */
export function controlesExport(salaries: readonly SalarieExport[], bulletins: readonly BulletinExport[]): Controle[] {
  const nom = new Map(salaries.map((s) => [s.id, s.nom]));
  const n = (id: string) => nom.get(id) ?? "Salarié inconnu";
  const avecBulletin = new Set(bulletins.map((b) => b.user_id));
  const controles: Controle[] = [];
  const ajouter = (niveau: Controle["niveau"], message: string, ids: string[]) => {
    if (ids.length) controles.push({ niveau, message, salaries: ids.map(n).sort((a, b) => a.localeCompare(b, "fr")) });
  };

  ajouter(
    "avertissement",
    "Bulletins en attente de validation par la direction",
    bulletins.filter((b) => statutValide(b.validation_status) === "en_attente").map((b) => b.user_id),
  );
  ajouter(
    "avertissement",
    "Bulletins refusés par la direction (à corriger)",
    bulletins.filter((b) => statutValide(b.validation_status) === "refuse").map((b) => b.user_id),
  );
  ajouter(
    "avertissement",
    "Salariés actifs sans bulletin ce mois",
    salaries.filter((s) => s.actif && !avecBulletin.has(s.id)).map((s) => s.id),
  );
  ajouter(
    "avertissement",
    "Bulletins indicatifs sans détail des cotisations (à refaire avec le moteur de paie)",
    bulletins.filter((b) => !b.details).map((b) => b.user_id),
  );

  const ecarts: string[] = [];
  const negatifs: string[] = [];
  for (const b of bulletins) {
    const d = b.details;
    if (!d) continue;
    const v = ventiler(d);
    const sal = RUBRIQUES.reduce((t, r) => t + v[r.id].salarial, 0);
    const pat = RUBRIQUES.reduce((t, r) => t + v[r.id].patronal, 0);
    if (
      Math.abs(sal - d.totalSalarial) > ECART ||
      Math.abs(pat - d.totalPatronal) > ECART ||
      Math.abs(Number(b.gross_amount ?? 0) - d.brut) > ECART ||
      Math.abs(Number(b.net_amount ?? 0) - d.netAPayer) > ECART
    )
      ecarts.push(b.user_id);
    if (d.netAPayer < 0) negatifs.push(b.user_id);
  }
  ajouter("avertissement", "Écarts entre les montants enregistrés et le détail du bulletin (régénérez le bulletin)", ecarts);
  ajouter("avertissement", "Net payé négatif", negatifs);
  ajouter(
    "info",
    "Bulletin papier demandé (opposition à la remise électronique)",
    salaries.filter((s) => s.papierDemande && (s.actif || avecBulletin.has(s.id))).map((s) => s.id),
  );
  return controles;
}
