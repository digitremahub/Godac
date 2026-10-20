import type { UserRole } from "@/lib/types/domain";

/**
 * Lot B — pure classification + routing rules for the human relay,
 * kept separate from any AI call so they're deterministic and unit
 * tested. "Which specific manager" (service-scoped) is resolved at
 * query time on /communication/assistance (same convention as /flotte/badges and the
 * dashboard's "tournées en cours" widget — see their own comments),
 * not stored as extra routing state here.
 */
export type SupportCategory = "travail" | "rh" | "bug_godac" | "autre";

const RH_KEYWORDS = ["paie", "salaire", "fiche de paie", "contrat", "rh", "ressources humaines", "médical", "arrêt maladie", "sanction", "licenciement", "disciplinaire"];
const BUG_KEYWORDS = ["bug", "bogue", "erreur", "plante", "ne fonctionne pas", "ne marche pas", "godac", "application", "logiciel", "site"];

export function classifySupportCategory(question: string): SupportCategory {
  const normalized = question.toLowerCase();
  if (RH_KEYWORDS.some((k) => normalized.includes(k))) return "rh";
  if (BUG_KEYWORDS.some((k) => normalized.includes(k))) return "bug_godac";
  return "travail";
}

export type SupportRecipient = "gestionnaire" | "support_godac";

/**
 * Per spec: "une question sur le travail ou les consignes va aux
 * managers du service du demandeur, sinon à la direction" (both are
 * `gestionnaire` here, since both are humans within the requester's
 * own organisation — /communication/assistance's own query scoping is what actually
 * narrows "which manager" vs "direction"). "Une question sur un bug
 * ou sur le fonctionnement de GODAC posée par la direction va au
 * support GODAC" — only direction's own bug reports leave the
 * organisation; the same bug report from anyone else still goes to
 * their own gestionnaire first (who can escalate to GODAC themselves).
 */
export function determineSupportRecipient(requesterRole: UserRole, category: SupportCategory): SupportRecipient {
  if (requesterRole === "direction" && category === "bug_godac") {
    return "support_godac";
  }
  return "gestionnaire";
}
