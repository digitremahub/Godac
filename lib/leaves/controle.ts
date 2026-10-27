import { joursOuvrables, verdictDemandeConges, type SoldeConges } from "@/lib/paie/conges";

/**
 * Contrôles serveur d'une demande de congé (le client n'est qu'une aide) :
 * service du demandeur, chevauchement avec ses propres demandes, solde.
 * Fichier pur, testé dans lib/leaves/__tests__/controle.test.ts.
 */

export type CodeRefusConge = "SERVICE_INVALIDE" | "CHEVAUCHEMENT" | "SOLDE_INSUFFISANT";

export type VerdictConge = { ok: true } | { ok: false; status: number; code: CodeRefusConge; erreur: string };

export interface CongeExistant {
  id?: string;
  du: string;
  au: string;
  status: string;
}

const dateFr = (j: string) => `${j.slice(8, 10)}/${j.slice(5, 7)}/${j.slice(0, 4)}`;

/** Demandes (en attente ou approuvées) du même salarié qui recouvrent la période, hors la demande elle-même. */
export function congesQuiSeChevauchent(du: string, au: string, existants: readonly CongeExistant[], idIgnore?: string): CongeExistant[] {
  return existants.filter((c) => c.id !== idIgnore && (c.status === "pending" || c.status === "approved") && c.du <= au && c.au >= du);
}

/**
 * Solde après cette demande, sans elle dans les demandes en attente. Solde de
 * reprise non renseigné : jugement impossible, la demande n'est pas bloquée
 * (l'écran le signale déjà).
 */
export function verdictSolde(p: { solde: Pick<SoldeConges, "disponibleApresAttente" | "repriseRenseignee"> | null; du: string; au: string; dejaCompteeEnAttente: boolean }) {
  if (!p.solde || !p.solde.repriseRenseignee) return { jugeable: false as const, insuffisant: false, message: "" };
  const jours = joursOuvrables(p.du, p.au);
  const sansElle = p.solde.disponibleApresAttente + (p.dejaCompteeEnAttente ? jours : 0);
  const v = verdictDemandeConges({ disponibleApresAttente: sansElle }, p.du, p.au);
  return { jugeable: true as const, insuffisant: v.insuffisant, message: v.message };
}

/** Contrôle d'une nouvelle demande (POST /api/leaves). */
export function controlerDemande(p: {
  du: string;
  au: string;
  serviceId: string;
  /** Services du demandeur (user_services). */
  servicesDuDemandeur: readonly string[];
  existants: readonly CongeExistant[];
  solde: Pick<SoldeConges, "disponibleApresAttente" | "repriseRenseignee"> | null;
  confirmerSoldeInsuffisant: boolean;
}): VerdictConge {
  if (!p.servicesDuDemandeur.includes(p.serviceId)) {
    return { ok: false, status: 403, code: "SERVICE_INVALIDE", erreur: "Ce service n'est pas l'un de vos services." };
  }
  const chevauche = congesQuiSeChevauchent(p.du, p.au, p.existants)[0];
  if (chevauche) {
    return { ok: false, status: 409, code: "CHEVAUCHEMENT", erreur: `Vous avez déjà une demande du ${dateFr(chevauche.du)} au ${dateFr(chevauche.au)} qui recouvre ces dates.` };
  }
  const s = verdictSolde({ solde: p.solde, du: p.du, au: p.au, dejaCompteeEnAttente: false });
  if (s.insuffisant && !p.confirmerSoldeInsuffisant) {
    return { ok: false, status: 409, code: "SOLDE_INSUFFISANT", erreur: `${s.message} Confirmez la demande pour l'envoyer malgré tout (congé anticipé ou sans solde).` };
  }
  return { ok: true };
}

/** Contrôle à l'approbation : pas de chevauchement avec un autre congé du salarié, solde confirmé si insuffisant. */
export function controlerApprobation(p: {
  idDemande: string;
  du: string;
  au: string;
  existants: readonly CongeExistant[];
  solde: Pick<SoldeConges, "disponibleApresAttente" | "repriseRenseignee"> | null;
  confirmerSoldeInsuffisant: boolean;
}): VerdictConge {
  const chevauche = congesQuiSeChevauchent(p.du, p.au, p.existants, p.idDemande).find((c) => c.status === "approved");
  if (chevauche) {
    return { ok: false, status: 409, code: "CHEVAUCHEMENT", erreur: `Ce salarié a déjà un congé approuvé du ${dateFr(chevauche.du)} au ${dateFr(chevauche.au)} qui recouvre ces dates.` };
  }
  const s = verdictSolde({ solde: p.solde, du: p.du, au: p.au, dejaCompteeEnAttente: true });
  if (s.insuffisant && !p.confirmerSoldeInsuffisant) {
    return { ok: false, status: 409, code: "SOLDE_INSUFFISANT", erreur: `${s.message} Confirmez l'approbation pour l'accorder malgré tout.` };
  }
  return { ok: true };
}

/** Message d'encadrement quand un congé approuvé tombe sur des affectations déjà posées. */
export function messageAffectationsConge(p: { nom: string; du: string; au: string; nombre: number }): string {
  return `Congé approuvé : ${p.nom} est absent du ${dateFr(p.du)} au ${dateFr(p.au)} mais ${p.nombre} affectation${p.nombre > 1 ? "s" : ""} du planning ${p.nombre > 1 ? "restent" : "reste"} posée${p.nombre > 1 ? "s" : ""} sur ces jours. À réattribuer ou à libérer dans le Planning.`;
}
