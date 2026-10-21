// Remise électronique des bulletins de paie (art. L3243-2 et D3243-7,
// D3243-8 du code du travail) : remise électronique par défaut, le
// salarié en est informé et peut s'y opposer à tout moment, depuis Mon
// espace › Mes fiches de paie. Son choix est daté (table
// payslip_delivery_preferences, migration 20261026000001). Fichier pur,
// testé dans lib/paie/__tests__/remise-electronique.test.ts.

export type ModeRemise = "electronique" | "papier";

export interface PreferenceRemise {
  paper_requested: boolean | null;
  decided_at: string | null;
}

export interface EtatRemise {
  mode: ModeRemise;
  /** Date du dernier choix du salarié ; null = aucun choix (électronique par défaut). */
  depuis: string | null;
}

/** Sans choix enregistré, la remise est électronique. */
export function etatRemise(pref: PreferenceRemise | null | undefined): EtatRemise {
  if (!pref) return { mode: "electronique", depuis: null };
  return { mode: pref.paper_requested ? "papier" : "electronique", depuis: pref.decided_at ?? null };
}

export function papierDemande(pref: PreferenceRemise | null | undefined): boolean {
  return etatRemise(pref).mode === "papier";
}

/**
 * Nouveau choix du salarié : la date est celle du serveur, jamais celle
 * du navigateur. Refusé s'il ne change rien (évite de réécrire la date
 * d'un choix déjà enregistré).
 */
export function enregistrerChoix(params: { actuel: PreferenceRemise | null | undefined; papier: boolean; maintenant: Date }): { ok: true; ligne: { paper_requested: boolean; decided_at: string } } | { ok: false; message: string } {
  const { actuel, papier, maintenant } = params;
  if (etatRemise(actuel).mode === (papier ? "papier" : "electronique") && actuel)
    return { ok: false, message: papier ? "Vous avez déjà demandé le bulletin papier." : "Vos bulletins vous sont déjà remis sous forme électronique." };
  return { ok: true, ligne: { paper_requested: papier, decided_at: maintenant.toISOString() } };
}

export const LIBELLE_PAPIER = "Bulletin papier demandé";

/** Durée de mise à disposition prévue par l'art. D3243-8. */
export const DUREE_LEGALE_DISPONIBILITE = "50 ans, ou jusqu'aux 75 ans du salarié";

export const INFORMATION_REMISE =
  "Vos bulletins de paie vous sont remis sous forme électronique, dans GODAC. Vous pouvez vous y opposer à tout moment : l'entreprise vous remettra alors vos bulletins sur papier, à partir du mois suivant votre demande.";

/** Libellé du choix enregistré, pour l'écran du salarié. */
export function libelleEtat(e: EtatRemise): string {
  const date = e.depuis ? new Date(e.depuis).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) : null;
  if (e.mode === "papier") return `Bulletin papier demandé${date ? ` le ${date}` : ""}.`;
  return date ? `Remise électronique choisie le ${date}.` : "Remise électronique (par défaut).";
}
