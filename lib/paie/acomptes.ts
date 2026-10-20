// Demandes d'acompte sur salaire : règles pures, miroir de la base
// (trigger salary_advance_requests_guard et RLS de la migration
// 20261024000002). L'écran et l'API s'en servent, la base reste
// l'autorité. Testées dans lib/paie/__tests__/acomptes.test.ts.
//
// Parcours : le salarié demande un montant pour le mois en cours → la
// direction accepte (montant modifiable, date de versement) ou refuse
// (motif) ; le comptable peut préparer (montant, date) mais seule la
// direction décide, comme pour la validation des bulletins → l'acompte
// accepté est déduit automatiquement du net à payer du bulletin du mois
// (ligne « Acompte du JJ/MM »). Un bulletin déjà validé n'est jamais
// modifié : l'acompte passe sur le bulletin suivant.

import type { Retenue } from "@/lib/paie/types";
import type { UserRole } from "@/lib/types/domain";

export const STATUTS_ACOMPTE = ["en_attente", "acceptee", "refusee", "versee", "annulee"] as const;
export type StatutAcompte = (typeof STATUTS_ACOMPTE)[number];

export const LIBELLES_ACOMPTE: Record<StatutAcompte, string> = {
  en_attente: "En attente",
  acceptee: "Acceptée",
  refusee: "Refusée",
  versee: "Versée",
  annulee: "Annulée",
};

/** Statuts dont le montant est déduit du bulletin. */
export const STATUTS_A_DEDUIRE: readonly StatutAcompte[] = ["acceptee", "versee"];

/** Plafond par défaut : la moitié du net habituel. */
export const PLAFOND_POURCENTAGE_DEFAUT = 50;

export interface DemandeAcompte {
  id: string;
  user_id: string;
  /** Premier jour du mois (AAAA-MM-01). */
  period: string;
  amount_requested: number;
  amount_granted: number | null;
  reason: string | null;
  status: StatutAcompte;
  decided_at: string | null;
  decision_comment: string | null;
  /** Date de versement (AAAA-MM-JJ). */
  paid_at: string | null;
  payslip_id: string | null;
  /** Mois d'origine quand l'acompte a été reporté (bulletin déjà validé). */
  original_period?: string | null;
  created_at: string;
}

export function statutAcompte(v: unknown): StatutAcompte {
  return (STATUTS_ACOMPTE as readonly string[]).includes(v as string) ? (v as StatutAcompte) : "en_attente";
}

/** "2026-10-14" ou "2026-10-01" → "2026-10". */
export const moisDe = (date: string) => date.slice(0, 7);

/** "2026-12" → "2027-01". */
export function moisSuivant(mois: string): string {
  const [y, m] = mois.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** "2026-10" → "10/2026". */
export const moisLisible = (mois: string) => `${mois.slice(5, 7)}/${mois.slice(0, 4)}`;

/** "2026-10-14" → "14/10". */
export const jourMois = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montant retenu : accordé, sinon demandé. */
export function montantAcompte(d: Pick<DemandeAcompte, "amount_granted" | "amount_requested">): number {
  return r2(Number(d.amount_granted ?? d.amount_requested ?? 0));
}

/**
 * Plafond indicatif d'une demande, réglé par l'organisation
 * (payroll_settings) : un montant fixe s'il est renseigné, sinon un
 * pourcentage (50 % par défaut) du net habituel, c'est-à-dire le net à
 * payer avant retenues du dernier bulletin validé. Arrondi à l'euro
 * inférieur. null : pas de référence (aucun bulletin validé) — la
 * direction juge au cas par cas.
 */
export function plafondAcompte(params: { netHabituel: number | null; pourcentage?: number | null; montantFixe?: number | null }): number | null {
  const fixe = Number(params.montantFixe ?? 0);
  if (fixe > 0) return Math.floor(fixe);
  const net = Number(params.netHabituel ?? 0);
  if (!(net > 0)) return null;
  const pct = params.pourcentage === null || params.pourcentage === undefined ? PLAFOND_POURCENTAGE_DEFAUT : Number(params.pourcentage);
  if (!(pct > 0)) return null;
  return Math.floor((net * Math.min(pct, 100)) / 100);
}

export type ResultatDemande = { ok: true; avertissement: string | null } | { ok: false; message: string };

/** Contrôle d'une nouvelle demande, côté salarié. */
export function verifierDemande(params: { montant: number; plafond: number | null; demandesDuMois: Pick<DemandeAcompte, "status">[] }): ResultatDemande {
  const { montant, plafond, demandesDuMois } = params;
  if (!(montant > 0)) return { ok: false, message: "Indiquez un montant supérieur à zéro." };
  if (montant > 100000) return { ok: false, message: "Montant trop élevé." };
  if (demandesDuMois.some((d) => d.status === "en_attente")) {
    return { ok: false, message: "Une demande est déjà en attente ce mois-ci : annulez-la ou attendez la réponse." };
  }
  const avertissement =
    plafond !== null && montant > plafond ? `Montant au-delà du plafond indicatif (${plafond} €) : la direction décidera.` : null;
  return { ok: true, avertissement };
}

export type ActionAcompte = "annuler" | "preparer" | "accepter" | "refuser" | "verser";

export type ResultatAction =
  | { ok: true; statut: StatutAcompte; decision: boolean }
  | { ok: false; message: string };

/**
 * Qui peut faire quoi sur une demande (miroir du trigger de garde) :
 * - l'auteur annule sa demande tant qu'elle est en attente ;
 * - le comptable prépare (montant, date) une demande en attente et
 *   marque versé un acompte accepté — il ne décide pas ;
 * - la direction accepte, refuse (motif obligatoire), annule ou marque versé.
 * `decision` : l'action fixe qui a décidé et quand.
 */
export function actionAcompte(params: { role: UserRole; estAuteur: boolean; action: ActionAcompte; statut: StatutAcompte; montant?: number | null; commentaire?: string | null }): ResultatAction {
  const { role, estAuteur, action, statut } = params;
  const direction = role === "direction";
  const gestion = direction || role === "comptable";
  switch (action) {
    case "annuler":
      if (statut === "en_attente" && (estAuteur || direction)) return { ok: true, statut: "annulee", decision: !estAuteur };
      if (statut === "acceptee" && direction) return { ok: true, statut: "annulee", decision: true };
      return { ok: false, message: estAuteur ? "Seule une demande en attente peut être annulée." : "Action réservée à la direction." };
    case "preparer":
      if (!gestion) return { ok: false, message: "Action réservée à la direction et au comptable." };
      if (statut !== "en_attente") return { ok: false, message: "Seule une demande en attente se prépare." };
      if (params.montant !== undefined && params.montant !== null && !(params.montant > 0)) return { ok: false, message: "Montant invalide." };
      return { ok: true, statut, decision: false };
    case "accepter":
      if (!direction) return { ok: false, message: "Seule la direction accepte une demande d'acompte." };
      if (statut !== "en_attente") return { ok: false, message: "Cette demande a déjà reçu une réponse." };
      if (!(Number(params.montant ?? 0) > 0)) return { ok: false, message: "Indiquez le montant accordé." };
      return { ok: true, statut: "acceptee", decision: true };
    case "refuser":
      if (!direction) return { ok: false, message: "Seule la direction refuse une demande d'acompte." };
      if (statut !== "en_attente") return { ok: false, message: "Cette demande a déjà reçu une réponse." };
      if (!params.commentaire?.trim()) return { ok: false, message: "Indiquez le motif du refus." };
      return { ok: true, statut: "refusee", decision: true };
    case "verser":
      if (!gestion) return { ok: false, message: "Action réservée à la direction et au comptable." };
      if (statut !== "acceptee") return { ok: false, message: "Seul un acompte accepté peut être marqué versé." };
      return { ok: true, statut: "versee", decision: false };
  }
}

/**
 * Mois sur lequel un acompte accepté sera déduit : son mois, ou le premier
 * mois suivant dont le bulletin n'est pas déjà validé.
 */
export function moisDeDeduction(mois: string, moisValides: ReadonlySet<string>): string {
  let m = mois;
  for (let i = 0; i < 24 && moisValides.has(m); i++) m = moisSuivant(m);
  return m;
}

export interface AcomptesDuBulletin {
  /** Lignes « Acompte du JJ/MM » à déduire du net. */
  retenues: Retenue[];
  /** Demandes intégrées (payslip_id à poser). */
  ids: string[];
  avertissements: string[];
}

/** Libellé de la ligne du bulletin : date de versement, sinon de décision, sinon de demande. */
export function libelleAcompte(d: Pick<DemandeAcompte, "paid_at" | "decided_at" | "created_at">): string {
  const date = d.paid_at ?? d.decided_at ?? d.created_at;
  return `Acompte du ${jourMois(date.slice(0, 10))}`;
}

/**
 * Acomptes à déduire du bulletin d'un mois : acceptés ou versés, de ce
 * mois ou d'un mois antérieur pas encore déduit (report), et ceux déjà
 * rattachés à ce bulletin. Un bulletin validé n'est jamais complété :
 * seuls ses acomptes déjà rattachés y restent, les autres attendent le
 * bulletin suivant (avertissement).
 */
export function acomptesDuBulletin(params: {
  demandes: DemandeAcompte[];
  mois: string;
  bulletin: { id: string; valide: boolean } | null;
}): AcomptesDuBulletin {
  const { demandes, mois, bulletin } = params;
  const retenues: Retenue[] = [];
  const ids: string[] = [];
  const avertissements: string[] = [];
  const candidates = demandes
    .filter((d) => STATUTS_A_DEDUIRE.includes(d.status) && montantAcompte(d) > 0 && moisDe(d.period) <= mois)
    .filter((d) => d.payslip_id === null || (bulletin !== null && d.payslip_id === bulletin.id))
    .sort((a, b) => (a.paid_at ?? a.created_at).localeCompare(b.paid_at ?? b.created_at));

  const reportes: DemandeAcompte[] = [];
  for (const d of candidates) {
    if (bulletin?.valide && d.payslip_id !== bulletin.id) {
      reportes.push(d);
      continue;
    }
    retenues.push({ type: "acompte", libelle: libelleAcompte(d), montant: montantAcompte(d), demandeId: d.id });
    ids.push(d.id);
    if (moisDe(d.period) < mois) {
      avertissements.push(`${libelleAcompte(d)} (${montantAcompte(d).toFixed(2)} €) reporté de ${moisLisible(moisDe(d.period))} : le bulletin de ce mois-là était déjà validé.`);
    }
  }
  if (reportes.length) {
    const total = r2(reportes.reduce((t, d) => t + montantAcompte(d), 0));
    avertissements.push(
      `${reportes.length} acompte${reportes.length > 1 ? "s" : ""} accepté${reportes.length > 1 ? "s" : ""} (${total.toFixed(2)} €) après la validation de ce bulletin : il${reportes.length > 1 ? "s seront déduits" : " sera déduit"} du bulletin de ${moisLisible(moisSuivant(mois))}. Le bulletin validé n'est pas modifié.`,
    );
  }
  return { retenues, ids, avertissements };
}

/**
 * Retenues du bulletin : celles saisies (sans les lignes d'acompte
 * automatiques, qui ne viennent jamais du navigateur) puis les acomptes
 * relus en base.
 */
export function fusionnerRetenues(saisies: Retenue[] | undefined, acomptes: Retenue[]): Retenue[] {
  return [...(saisies ?? []).filter((r) => !r.demandeId), ...acomptes];
}

/** Mois en cours, heure de Paris (AAAA-MM). */
export function moisCourantParis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(maintenant).slice(0, 7);
}

/** Aujourd'hui, heure de Paris (AAAA-MM-JJ). */
export function aujourdhuiParis(maintenant: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(maintenant);
}
