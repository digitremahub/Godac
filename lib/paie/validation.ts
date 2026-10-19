// Validation des bulletins par la direction (décision client Q1 révisée).
// Règles pures, miroir de la base (trigger payslips_guard_validation et
// RLS de la migration 20261020000003) : l'écran et l'API s'en servent,
// la base reste l'autorité. Testées dans lib/paie/__tests__/validation.test.ts.

import type { UserRole } from "@/lib/types/domain";

export const STATUTS_VALIDATION = ["en_attente", "valide", "refuse"] as const;
export type StatutValidation = (typeof STATUTS_VALIDATION)[number];

export const LIBELLES_VALIDATION: Record<StatutValidation, string> = {
  en_attente: "En attente de validation direction",
  valide: "Validé",
  refuse: "Refusé",
};

/** Qui prépare et génère les bulletins. */
export const ROLES_GENERATION: readonly UserRole[] = ["direction", "comptable"];
/** Qui valide ou refuse. */
export const ROLES_VALIDATION: readonly UserRole[] = ["direction"];

export function peutGenerer(role: UserRole): boolean {
  return ROLES_GENERATION.includes(role);
}

export function peutValider(role: UserRole): boolean {
  return ROLES_VALIDATION.includes(role);
}

export type Decision = "valider" | "refuser";

export type ResultatDecision = { ok: true; statut: StatutValidation } | { ok: false; message: string };

/** Décision de la direction sur un bulletin. */
export function deciderValidation(params: { role: UserRole; decision: Decision; commentaire?: string | null; statutActuel: StatutValidation }): ResultatDecision {
  const { role, decision, commentaire, statutActuel } = params;
  if (!peutValider(role)) return { ok: false, message: "Seule la direction peut valider ou refuser un bulletin." };
  if (decision === "refuser") {
    if (!commentaire || !commentaire.trim()) return { ok: false, message: "Indiquez au comptable la raison du refus." };
    if (statutActuel === "refuse") return { ok: false, message: "Ce bulletin est déjà refusé." };
    return { ok: true, statut: "refuse" };
  }
  if (statutActuel === "valide") return { ok: false, message: "Ce bulletin est déjà validé." };
  return { ok: true, statut: "valide" };
}

/** Statut d'un bulletin qui vient d'être généré ou régénéré. */
export function statutApresGeneration(): StatutValidation {
  return "en_attente";
}

/**
 * Ce qu'un bulletin permet, selon son statut : tant que la direction n'a
 * pas validé, aucun effet (salarié, envoi, export définitif, report de
 * la retenue récurrente, cumuls annuels).
 */
export function effets(statut: StatutValidation | null | undefined) {
  const valide = statut === "valide";
  return {
    visibleParLeSalarie: valide,
    envoi: valide,
    exportDefinitif: valide,
    reportRetenuesRecurrentes: valide,
    compteDansLesCumuls: valide,
  };
}

/** Bulletin lisible par un utilisateur (miroir de la policy SELECT). */
export function lisiblePar(params: { role: UserRole; userId: string; bulletin: { user_id: string; validation_status: StatutValidation } }): boolean {
  const { role, userId, bulletin } = params;
  if (role === "direction" || role === "comptable") return true;
  return bulletin.user_id === userId && bulletin.validation_status === "valide";
}

export function statutValide(v: unknown): StatutValidation {
  return (STATUTS_VALIDATION as readonly string[]).includes(v as string) ? (v as StatutValidation) : "en_attente";
}
