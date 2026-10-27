/**
 * Facture impayée (Stripe invoice.payment_failed). Fichier pur, testé dans
 * lib/stripe/__tests__/impaye.test.ts.
 *
 * Aucun blocage d'accès : un paiement échoué ne coupe pas les modules (délai de
 * grâce, Stripe relance de son côté). L'état sert à prévenir la direction (alerte
 * cloche + e-mail) et à afficher un bandeau dans les réglages de facturation.
 * Un blocage après X jours se brancherait sur `organizations.subscription_status`
 * (past_due / canceled) ou sur `payment_failed_at` dans lib/organization/modules.ts
 * (getEnabledModuleKeys) : voir `joursDepuisImpaye`.
 */

export const TITRE_BANDEAU_IMPAYE = "Paiement échoué : régularisez";

export interface FactureImpayee {
  id: string;
  /** Montant dû, en centimes. */
  amount_due?: number | null;
  currency?: string | null;
  attempt_count?: number | null;
  /** Prochaine tentative automatique (secondes Unix), si Stripe en prévoit une. */
  next_payment_attempt?: number | null;
}

/** Clé de dédoublonnage de l'alerte : une par facture et par tentative (une nouvelle tentative échouée prévient à nouveau). */
export function cleAlerteImpaye(f: Pick<FactureImpayee, "id" | "attempt_count">): string {
  return `paiement:${f.id}:${f.attempt_count ?? 1}`;
}

export function montantFacture(f: Pick<FactureImpayee, "amount_due" | "currency">): string | null {
  if (f.amount_due === null || f.amount_due === undefined) return null;
  try {
    return (f.amount_due / 100).toLocaleString("fr-FR", { style: "currency", currency: (f.currency ?? "eur").toUpperCase() });
  } catch {
    return null;
  }
}

/** Message de l'alerte de la direction. */
export function messageImpaye(f: FactureImpayee): string {
  const montant = montantFacture(f);
  const tentative = f.attempt_count && f.attempt_count > 1 ? `, tentative n°${f.attempt_count}` : "";
  const relance = f.next_payment_attempt ? ` Une nouvelle tentative est prévue le ${new Date(f.next_payment_attempt * 1000).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" })}.` : "";
  return `Le paiement de votre abonnement GODAC a échoué${montant ? ` (${montant}${tentative})` : ""}. Régularisez votre moyen de paiement dans Abonnement & modules.${relance} Vos modules restent accessibles pour le moment.`;
}

/** Jours écoulés depuis le premier échec (null : aucun impayé). Point d'accroche d'un éventuel blocage après X jours. */
export function joursDepuisImpaye(paymentFailedAt: string | null | undefined, maintenant: Date = new Date()): number | null {
  if (!paymentFailedAt) return null;
  const t = Date.parse(paymentFailedAt);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((maintenant.getTime() - t) / 86_400_000));
}

/** Le bandeau « Paiement échoué » s'affiche : impayé enregistré, ou statut d'abonnement en retard de paiement. */
export function impayeAffiche(org: { payment_failed_at?: string | null; subscription_status?: string | null }): boolean {
  return Boolean(org.payment_failed_at) || org.subscription_status === "past_due";
}
