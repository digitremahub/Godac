// Fin de contrat : règles de suppression des données, partie pure (testée dans
// lib/fin-contrat/__tests__/regles.test.ts). Aucune base, aucun réseau.
//
// Engagement publié (CGV art. 11, DPA art. 9, confidentialité) : les données
// du Client sont supprimées 3 mois après la fin du contrat, sauf obligation
// légale de conservation. Mise en œuvre :
//   - fin de contrat + 60 jours : préavis écrit au contact de l'organisation
//     (30 jours avant la suppression) avec rappel de l'export des données ;
//   - fin de contrat + 90 jours ET au moins 30 jours après l'envoi du préavis :
//     suppression, si rien ne la bloque ;
//   - blocage : un litige déclaré (organizations.suppression_bloquee, posé par
//     la direction GODAC) suspend tout (ni préavis ni suppression) ;
//   - suppression réelle seulement si FIN_CONTRAT_PURGE_ACTIVE vaut « true » ;
//     sinon DRY-RUN : on journalise ce qui serait fait, rien n'est envoyé ni supprimé.
// La suppression est irréversible : en cas de doute, la règle retient.

/** Jours après la fin du contrat avant l'envoi du préavis. */
export const JOURS_AVANT_PREAVIS = 60;
/** Jours après la fin du contrat avant la suppression (3 mois). */
export const JOURS_AVANT_SUPPRESSION = 90;
/** Délai minimal entre l'envoi du préavis et la suppression. */
export const JOURS_PREAVIS_MINIMUM = 30;
/** Plafond de suppressions par passage : garde-fou contre une erreur de données qui viserait beaucoup d'organisations. */
export const SUPPRESSIONS_MAX_PAR_PASSAGE = 3;

const JOUR_MS = 86_400_000;

/** Variable d'environnement qui active la suppression réelle (et l'envoi des préavis). */
export const VARIABLE_PURGE_ACTIVE = "FIN_CONTRAT_PURGE_ACTIVE";

/** Strictement « true » : toute autre valeur (absente, « 1 », « yes »…) laisse le DRY-RUN. */
export function purgeActive(env: Record<string, string | undefined> = process.env): boolean {
  return env[VARIABLE_PURGE_ACTIVE]?.trim() === "true";
}

/** Colonnes lues sur `organizations`. */
export interface OrganisationFinContrat {
  id: string;
  name: string;
  is_demo?: boolean | null;
  subscription_status?: string | null;
  stripe_subscription_id?: string | null;
  offre?: string | null;
  trial_ends_at?: string | null;
  contrat_termine_le?: string | null;
  suppression_preavis_envoye_le?: string | null;
  suppression_bloquee?: boolean | null;
  suppression_bloquee_motif?: string | null;
}

export const COLONNES_FIN_CONTRAT =
  "id, name, is_demo, subscription_status, stripe_subscription_id, offre, trial_ends_at, contrat_termine_le, suppression_preavis_envoye_le, suppression_bloquee, suppression_bloquee_motif";

/** Statuts d'abonnement qui, avec un abonnement Stripe, signifient que le contrat est en cours. */
export const STATUTS_ABONNEMENT_VIVANT = ["active", "past_due", "trialing", "incomplete"] as const;

const OFFRE_GO_NAVIGATION = "go_navigation";

function instant(v: string | null | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Un abonnement Stripe en cours (actif, impayé, en essai Stripe ou en création) : le contrat n'est pas terminé. */
export function abonnementVivant(org: OrganisationFinContrat): boolean {
  return Boolean(org.stripe_subscription_id) && (STATUTS_ABONNEMENT_VIVANT as readonly string[]).includes(org.subscription_status ?? "");
}

/**
 * Date de fin de contrat, ou null si le contrat n'est pas terminé ou si la date
 * est inconnue. Sources, dans l'ordre :
 *  1. organizations.contrat_termine_le (webhook Stripe à l'annulation, ou posée par GODAC) ;
 *  2. un compte d'essai GO Navigation sans abonnement : la fin de l'essai (CGV art. 3 :
 *     les données de l'essai sont traitées comme celles d'un contrat arrivé à son terme).
 * Jamais pour une organisation de démonstration ni pour un abonnement vivant.
 * Une organisation sans date connue n'est JAMAIS supprimée automatiquement (ex. client
 * facturé hors Stripe : GODAC pose la date depuis le back-office).
 */
export function dateFinContrat(org: OrganisationFinContrat): Date | null {
  if (org.is_demo) return null;
  if (abonnementVivant(org)) return null;
  const pose = instant(org.contrat_termine_le);
  if (pose !== null) return new Date(pose);
  if (org.offre === OFFRE_GO_NAVIGATION && !org.stripe_subscription_id) {
    const essai = instant(org.trial_ends_at);
    if (essai !== null) return new Date(essai);
  }
  return null;
}

/** Date d'envoi du préavis, si elle est postérieure à la fin du contrat (un ancien préavis, d'un contrat précédent, ne compte pas). */
export function preavisEnvoye(org: OrganisationFinContrat, fin: Date): Date | null {
  const p = instant(org.suppression_preavis_envoye_le);
  if (p === null || p < fin.getTime()) return null;
  return new Date(p);
}

/** Date de suppression au plus tôt : fin + 90 jours, et jamais moins de 30 jours après le préavis. */
export function dateSuppressionPrevue(fin: Date, preavis: Date | null, maintenant: Date): Date {
  const parContrat = fin.getTime() + JOURS_AVANT_SUPPRESSION * JOUR_MS;
  const parPreavis = (preavis ?? maintenant).getTime() + JOURS_PREAVIS_MINIMUM * JOUR_MS;
  return new Date(Math.max(parContrat, parPreavis));
}

export type Decision =
  | { action: "aucune"; raison: string }
  | { action: "bloquee"; raison: string }
  | { action: "attente"; raison: string; date: Date }
  | { action: "preavis"; suppressionPrevue: Date; raison: string }
  | { action: "suppression"; raison: string };

/** Ce qu'il faut faire d'une organisation à cet instant. Pur : ne dépend que de ses arguments. */
export function decider(org: OrganisationFinContrat, maintenant: Date): Decision {
  if (org.is_demo) return { action: "aucune", raison: "organisation de démonstration" };
  if (abonnementVivant(org)) return { action: "aucune", raison: "abonnement en cours" };
  const fin = dateFinContrat(org);
  if (!fin) return { action: "aucune", raison: "contrat en cours ou date de fin inconnue" };
  if (fin.getTime() > maintenant.getTime()) return { action: "aucune", raison: "fin de contrat à venir" };
  if (org.suppression_bloquee) {
    return { action: "bloquee", raison: `suppression bloquée (litige)${org.suppression_bloquee_motif ? ` : ${org.suppression_bloquee_motif}` : ""}` };
  }

  const preavis = preavisEnvoye(org, fin);
  if (!preavis) {
    const due = new Date(fin.getTime() + JOURS_AVANT_PREAVIS * JOUR_MS);
    if (maintenant.getTime() < due.getTime()) return { action: "attente", raison: "préavis pas encore dû", date: due };
    return { action: "preavis", suppressionPrevue: dateSuppressionPrevue(fin, null, maintenant), raison: "préavis dû et non envoyé" };
  }

  const prevue = dateSuppressionPrevue(fin, preavis, maintenant);
  if (maintenant.getTime() < prevue.getTime()) return { action: "attente", raison: "préavis envoyé, suppression pas encore due", date: prevue };
  return { action: "suppression", raison: "fin de contrat + 90 jours et préavis envoyé depuis 30 jours au moins" };
}

export interface ActionPlanifiee {
  organisationId: string;
  nom: string;
  decision: Decision;
  /** Faux en DRY-RUN : l'action est seulement journalisée. */
  executer: boolean;
  /** Suppression repoussée au prochain passage (plafond par passage atteint). */
  reportee?: boolean;
}

/**
 * Plan d'un passage : une décision par organisation, la suppression réelle
 * seulement si `purgeActive`, et au plus SUPPRESSIONS_MAX_PAR_PASSAGE suppressions
 * par passage (les suivantes sont reportées au lendemain).
 */
export function planifier(orgs: readonly OrganisationFinContrat[], maintenant: Date, actif: boolean): ActionPlanifiee[] {
  let suppressions = 0;
  const plan: ActionPlanifiee[] = [];
  for (const org of orgs) {
    const decision = decider(org, maintenant);
    let executer = actif && (decision.action === "preavis" || decision.action === "suppression");
    let reportee: boolean | undefined;
    if (decision.action === "suppression") {
      if (suppressions >= SUPPRESSIONS_MAX_PAR_PASSAGE) {
        executer = false;
        reportee = true;
      } else {
        suppressions += 1;
      }
    }
    plan.push({ organisationId: org.id, nom: org.name, decision, executer, ...(reportee ? { reportee } : {}) });
  }
  return plan;
}

/** Ligne de journal d'un passage (une ligne par organisation concernée ; JSON pour les journaux Vercel). */
export function ligneJournal(a: ActionPlanifiee, actif: boolean): string {
  const d = a.decision;
  const date = d.action === "preavis" ? d.suppressionPrevue : d.action === "attente" ? d.date : null;
  const verbe =
    d.action === "preavis" ? (a.executer ? "PREAVIS_ENVOYE" : "DRY_RUN_PREAVIS") : d.action === "suppression" ? (a.executer ? "SUPPRESSION" : a.reportee ? "REPORTEE" : "DRY_RUN_SUPPRESSION") : d.action === "bloquee" ? "BLOQUEE" : d.action === "attente" ? "ATTENTE" : "AUCUNE";
  return JSON.stringify({ evenement: "fin_contrat", mode: actif ? "actif" : "dry-run", organisation: a.organisationId, nom: a.nom, resultat: verbe, raison: d.raison, ...(date ? { date: date.toISOString().slice(0, 10) } : {}) });
}

// ── Conservation du strict nécessaire ───────────────────────────────────

/**
 * Actions du journal d'audit copiées dans `organisations_supprimees_journal`
 * avant la suppression : preuves d'acceptation / de consentement et traces du
 * préavis et du blocage. Tout le reste du journal part avec l'organisation.
 * Doit rester alignée avec ACTIONS_AUDIT (lib/audit/journal.ts).
 */
export const ACTIONS_AUDIT_CONSERVEES = [
  "inscription_go_navigation",
  "accord_usage_essai",
  "accuse_parametres_indicatifs",
  "fin_contrat_preavis",
  "fin_contrat_date_modifiee",
  "fin_contrat_suppression_bloquee",
] as const;

/** Ce que GODAC garde après la suppression, et pourquoi (reprise dans docs/garde-fous-techniques.md). */
export const ELEMENTS_CONSERVES = [
  { element: "Identité de facturation et identifiants Stripe (nom, SIRET, adresse légale, client et abonnement Stripe, dates de contrat)", base: "Obligations comptables : factures à conserver 10 ans (code de commerce L. 123-22) ; les factures elles-mêmes restent chez Stripe" },
  { element: "Preuves d'acceptation et de consentement (inscription à l'essai, accord de partage d'usage, accusé de lecture des paramètres indicatifs)", base: "Preuve en cas de litige (prescription de 5 ans, code de commerce L. 110-4)" },
  { element: "Traces du préavis, des changements de date de fin, du blocage, et de la suppression elle-même", base: "Preuve de la bonne exécution de l'engagement de suppression" },
] as const;

/** Buckets de stockage où les fichiers d'une organisation sont rangés sous le préfixe `<organization_id>/`. */
export const BUCKETS_PAR_ORGANISATION = [
  "delivery-proofs",
  "dispute-docs",
  "employee-documents",
  "fine-photos",
  "fuel-tickets",
  "intervention-photos",
  "messenger-photos",
  "org-logos",
  "payslips",
  "rental-invoices",
  "tank-invoices",
  "tank-photos",
  "ticpe-exports",
  "tour-photos",
  "vehicle-documents",
  "work-stoppage-docs",
] as const;

// ── Champs posés par le webhook Stripe ──────────────────────────────────

export interface AbonnementStripeMinimal {
  status: string;
  ended_at?: number | null;
  canceled_at?: number | null;
}

/**
 * Colonnes de fin de contrat à écrire quand l'état de l'abonnement change :
 *  - abonnement terminé (« canceled ») : date de fin = ended_at, sinon canceled_at, sinon maintenant ;
 *  - abonnement vivant : date de fin et préavis remis à zéro (réactivation) ;
 *  - autre statut (pause, expiration à la création) : rien.
 * `poserDate` indique d'écrire la date seulement si elle est encore vide.
 */
export function champsFinContratStripe(sub: AbonnementStripeMinimal, maintenant: Date = new Date()): { action: "terminer"; contrat_termine_le: string } | { action: "reactiver" } | { action: "rien" } {
  if (sub.status === "canceled") {
    const secondes = sub.ended_at ?? sub.canceled_at ?? null;
    return { action: "terminer", contrat_termine_le: (secondes ? new Date(secondes * 1000) : maintenant).toISOString() };
  }
  if (["active", "trialing", "past_due", "unpaid"].includes(sub.status)) return { action: "reactiver" };
  return { action: "rien" };
}
