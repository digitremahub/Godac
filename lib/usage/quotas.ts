/**
 * Quotas et facturation à la dépense des fonctions payantes — logique
 * pure (sans base ni réseau), testée dans lib/usage/__tests__. Le
 * compteur côté serveur est lib/usage/consommer.ts, la facturation
 * mensuelle app/api/cron/usage-billing.
 */
import { parisDay, parisMidnightIso, parisMonthStartDay, parisMonthStartIso } from "@/lib/utils/paris-time";

export const USAGE_FEATURES = [
  "ocr_ticket",
  "ocr_tour_report",
  "tour_report_reread",
  "ocr_counter",
  "ocr_totalizer",
  "ocr_fine",
  "ocr_label",
  "contestation",
  "vehicle_ai_specs",
  "import_ai",
  "assistant",
] as const;
export type UsageFeature = (typeof USAGE_FEATURES)[number];

export const PLAN_TIERS = ["essentiel", "starter", "pro", "business"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Libellés de repli (la base, `usage_prices.label`, fait foi pour l'affichage). */
export const LIBELLES_FONCTION: Record<UsageFeature, string> = {
  ocr_ticket: "la lecture des tickets carburant",
  ocr_tour_report: "la lecture des rapports de tournée",
  tour_report_reread: "la relecture des rapports de tournée",
  ocr_counter: "la lecture des compteurs kilométriques",
  ocr_totalizer: "la lecture des totalisateurs de cuve",
  ocr_fine: "la lecture des avis de contravention",
  ocr_label: "la lecture des étiquettes colis",
  contestation: "la lecture des contestations clients",
  vehicle_ai_specs: "les fiches véhicule complétées par IA",
  import_ai: "l'import de fichiers assisté par IA",
  assistant: "l'assistant GODAC",
};

/**
 * Formule de l'entreprise : `organizations.plan` (texte écrit par
 * Stripe/onboarding, celui que le checkout facture) d'abord, sinon
 * `plan_id`, sinon Starter (formule par défaut à l'inscription).
 */
export function resoudreFormule(plan: string | null | undefined, planId?: string | null): PlanTier {
  for (const p of [plan, planId]) if (p && (PLAN_TIERS as readonly string[]).includes(p)) return p as PlanTier;
  return "starter";
}

/** Plafond journalier de sécurité par défaut : 10× la moyenne journalière incluse, 20 au minimum. */
export function plafondJournalierParDefaut(inclusParMois: number): number {
  return Math.max(20, Math.ceil((inclusParMois * 10) / 30));
}

export interface EtatQuota {
  inclusParMois: number;
  plafondJour: number;
  utiliseMois: number;
  utiliseJour: number;
  depassementAutorise: boolean;
}

export type DecisionConsommation =
  | { ok: true; unitesIncluses: number; unitesDepassement: number }
  | { ok: false; motif: "quota_mensuel" | "plafond_jour" };

/** Décide si `unites` supplémentaires peuvent être consommées, et combien seront facturées au-delà du forfait. */
export function deciderConsommation(etat: EtatQuota, unites: number): DecisionConsommation {
  if (etat.utiliseJour + unites > etat.plafondJour) return { ok: false, motif: "plafond_jour" };
  const resteInclus = Math.max(0, etat.inclusParMois - etat.utiliseMois);
  const unitesIncluses = Math.min(unites, resteInclus);
  const unitesDepassement = unites - unitesIncluses;
  if (unitesDepassement > 0 && !etat.depassementAutorise) return { ok: false, motif: "quota_mensuel" };
  return { ok: true, unitesIncluses, unitesDepassement };
}

/** Unités au-delà du volume inclus sur une période. */
export function unitesEnDepassement(utilise: number, inclus: number): number {
  return Math.max(0, utilise - inclus);
}

/** Montant en centimes d'euro (Stripe) pour `unites` à `prixUnitaire` € — arrondi au centime. */
export function montantCentimes(unites: number, prixUnitaire: number): number {
  return Math.round(unites * prixUnitaire * 100);
}

/** Paliers d'alerte (80 %, 100 % du volume inclus) franchis en passant de `avant` à `apres`. */
export function seuilsFranchis(inclus: number, avant: number, apres: number): (80 | 100)[] {
  if (inclus <= 0) return [];
  const out: (80 | 100)[] = [];
  for (const pct of [80, 100] as const) {
    const seuil = Math.ceil((inclus * pct) / 100);
    if (avant < seuil && apres >= seuil) out.push(pct);
  }
  return out;
}

export function formatEuro(montant: number): string {
  return `${montant.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
}

/** Message affiché quand la consommation est refusée. */
export function messageRefus(
  motif: "quota_mensuel" | "plafond_jour",
  fonction: UsageFeature,
  info: { inclusParMois: number; plafondJour: number; prixUnitaire: number | null },
): string {
  const libelle = LIBELLES_FONCTION[fonction] ?? fonction;
  if (motif === "plafond_jour") {
    return `Limite de sécurité journalière atteinte pour ${libelle} (${info.plafondJour} par jour). Réessayez demain ou contactez le support GODAC.`;
  }
  const prix = info.prixUnitaire !== null ? ` (${formatEuro(info.prixUnitaire)} HT l'unité)` : "";
  return `Quota mensuel atteint pour ${libelle} : ${info.inclusParMois} inclus dans votre formule ce mois-ci. La direction peut autoriser le dépassement facturé${prix} dans Abonnement › Consommation.`;
}

// ── Bornes de mois et de jour, heure de Paris ────────────────────────

export interface BornesMois {
  /** 'YYYY-MM' */
  periode: string;
  /** Début inclus, ISO UTC. */
  debut: string;
  /** Fin exclue (début du mois suivant), ISO UTC. */
  fin: string;
}

/** Mois de Paris contenant `instant`, décalé de `decalage` mois (-1 = mois précédent). */
export function bornesMoisParis(instant: Date = new Date(), decalage = 0): BornesMois {
  return {
    periode: parisMonthStartDay(instant, decalage).slice(0, 7),
    debut: parisMonthStartIso(instant, decalage),
    fin: parisMonthStartIso(instant, decalage + 1),
  };
}

/** Minuit (heure de Paris) du jour contenant `instant`, ISO UTC. */
export function debutJourParis(instant: Date = new Date()): string {
  return parisMidnightIso(parisDay(instant));
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** 'YYYY-MM' → « avril 2026 ». */
export function libellePeriode(periode: string): string {
  const [y, m] = periode.split("-").map(Number) as [number, number];
  return `${MOIS[m - 1]} ${y}`;
}

/** Libellé de la ligne de facture Stripe. */
export function descriptionLigneFacture(libelleFonction: string, unites: number, periode: string): string {
  return `${libelleFonction} — ${unites} au-delà du forfait (${libellePeriode(periode)})`;
}

export interface LigneDepassement {
  feature: string;
  unites: number;
  montantCentimes: number;
}

/** Lignes à facturer pour un mois : uniquement les fonctions en dépassement avec un prix > 0. */
export function lignesDepassement(
  totaux: { feature: string; units: number }[],
  inclus: Record<string, number>,
  prix: Record<string, number>,
): LigneDepassement[] {
  const out: LigneDepassement[] = [];
  for (const t of totaux) {
    const unites = unitesEnDepassement(t.units, inclus[t.feature] ?? 0);
    const montant = montantCentimes(unites, prix[t.feature] ?? 0);
    if (unites > 0 && montant > 0) out.push({ feature: t.feature, unites, montantCentimes: montant });
  }
  return out;
}

// ── Tableau « Consommation » (page Abonnement) ────────────────────────

export interface LigneConsommation {
  feature: string;
  libelle: string;
  uniteLibelle: string;
  utilise: number;
  inclus: number;
  depassement: number;
  prixUnitaire: number;
  coutEstime: number;
  /** Part du volume inclus consommée, en % (0 si rien d'inclus). */
  pourcentage: number;
}

/** Une ligne par fonction tarifée, dans l'ordre de la grille de prix. */
export function lignesConsommation(
  prix: { feature: string; label: string; unit_label: string; unit_price_eur: number }[],
  inclus: Record<string, number>,
  utilise: Record<string, number>,
): LigneConsommation[] {
  return prix.map((p) => {
    const u = utilise[p.feature] ?? 0;
    const i = inclus[p.feature] ?? 0;
    const depassement = unitesEnDepassement(u, i);
    return {
      feature: p.feature,
      libelle: p.label,
      uniteLibelle: p.unit_label,
      utilise: u,
      inclus: i,
      depassement,
      prixUnitaire: Number(p.unit_price_eur),
      coutEstime: montantCentimes(depassement, Number(p.unit_price_eur)) / 100,
      pourcentage: i > 0 ? Math.round((u / i) * 100) : 0,
    };
  });
}

/** Les `n` derniers mois (heure de Paris), du plus récent au plus ancien, mois courant compris. */
export function derniersMois(instant: Date, n: number): string[] {
  return Array.from({ length: n }, (_, k) => bornesMoisParis(instant, -k).periode);
}
