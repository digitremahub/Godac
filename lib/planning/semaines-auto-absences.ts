/**
 * Absences prises en compte à la génération du planning de la semaine suivante
 * (lib/planning/semaines-auto.ts) : congé approuvé, congé demandé (en attente),
 * arrêt de travail, compte inactif ou salarié sorti. Logique pure, testée dans
 * lib/planning/__tests__/semaines-auto.test.ts.
 *
 * Différence avec lib/planning/affectation.ts › estAbsent : un congé seulement
 * DEMANDÉ compte ici (la case est créée « à remplacer » plutôt que de poser un
 * chauffeur qui n'est peut-être pas là), et un compte inactif ou sorti aussi.
 * Le motif d'un arrêt n'est jamais restitué : « absent » seulement.
 */
import type { ArretPlanning } from "@/lib/planning/affectation";
import type { CongePlanning } from "@/lib/planning/semaine";

export type RaisonAbsence = "conge" | "conge_demande" | "absent";

export interface ContexteAbsences {
  conges: readonly CongePlanning[];
  arrets: readonly ArretPlanning[];
  /** Chauffeurs dont le compte est inactif. */
  inactifs: ReadonlySet<string>;
  /** Date de sortie (exit_date) par salarié : absent à partir de ce jour. */
  sorties: ReadonlyMap<string, string>;
}

export interface AbsenceDuJour {
  raison: RaisonAbsence;
  /** Dates du congé ; nulles pour un arrêt, un compte inactif ou une sortie. */
  du: string | null;
  au: string | null;
}

/**
 * Pourquoi ce chauffeur ne peut pas être placé ce jour-là, ou null. Ordre :
 * compte inactif ou sorti, arrêt de travail, congé approuvé, congé demandé.
 */
export function estAbsentOuInactif(driverId: string, date: string, ctx: ContexteAbsences): AbsenceDuJour | null {
  if (ctx.inactifs.has(driverId)) return { raison: "absent", du: null, au: null };
  const sortie = ctx.sorties.get(driverId);
  if (sortie && sortie <= date) return { raison: "absent", du: null, au: null };
  if (ctx.arrets.some((a) => a.user_id === driverId && date >= a.start_date && date <= a.end_date)) return { raison: "absent", du: null, au: null };
  const conges = ctx.conges.filter((c) => c.driver_id === driverId && date >= c.start_date && date <= c.end_date);
  const etendue = (statut: string) => {
    const l = conges.filter((c) => c.status === statut);
    if (!l.length) return null;
    return { du: l.reduce((m, c) => (c.start_date < m ? c.start_date : m), l[0]!.start_date), au: l.reduce((m, c) => (c.end_date > m ? c.end_date : m), l[0]!.end_date) };
  };
  const approuve = etendue("approved");
  if (approuve) return { raison: "conge", ...approuve };
  const demande = etendue("pending");
  if (demande) return { raison: "conge_demande", ...demande };
  return null;
}
