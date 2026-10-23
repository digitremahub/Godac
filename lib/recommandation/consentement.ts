import { EDITEUR } from "@/lib/legal/editeur";

/** Version du texte de consentement ; à incrémenter à chaque modification du texte. */
export const VERSION_CONSENTEMENT = "1.0";

/**
 * Texte exact accepté par le chauffeur : enregistré tel quel avec la
 * recommandation (preuve RGPD). Aucune donnée n'est envoyée à l'employeur
 * par le formulaire lui-même : seule l'équipe GODAC voit la recommandation.
 */
export const TEXTE_CONSENTEMENT = `J'accepte que GODAC contacte mon employeur pour lui présenter GODAC en mentionnant ma recommandation. Je peux retirer mon accord à tout moment en écrivant à ${EDITEUR.email}.`;

/** Texte stocké en base : version + texte, pour retrouver ce qui a été accepté. */
export function texteConsentementEnregistre(): string {
  return `[v${VERSION_CONSENTEMENT}] ${TEXTE_CONSENTEMENT}`;
}
