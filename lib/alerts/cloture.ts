/**
 * Clôture automatique des alertes dont la condition a disparu : tournée
 * terminée ou retard résorbé (tournee_retard), chauffeur affecté ou tournée
 * démarrée ou tournée fermée (tournee_sans_chauffeur, tournee_non_demarree ;
 * fermeture : lib/planning/fermeture-serveur.ts clôt tout de suite). Le statut passe à
 * « resolved » (même statut que le traitement d'un écart carburant) : elles
 * ne comptent plus dans « Notifications ouvertes ».
 *
 * Fichier pur : la sélection est testée dans lib/alerts/__tests__/cloture.test.ts,
 * l'écriture est faite par lib/exploitation/surveillance-serveur.ts.
 */

/** Types d'alerte clos tout seuls quand leur condition disparaît. */
export const TYPES_CLOTURE_AUTO = ["tournee_retard", "tournee_non_demarree", "tournee_sans_chauffeur"] as const;

export interface AlerteACloturer {
  id: string;
  type: string;
  related_id: string | null;
}

/**
 * Identifiants des alertes ouvertes à clore. `conditionsActives` donne, par
 * type, les éléments (related_id) dont la condition est encore vraie ; un
 * type absent de la table n'est pas évalué (on ne touche à rien), une alerte
 * sans related_id non plus.
 */
export function alertesAClore(ouvertes: readonly AlerteACloturer[], conditionsActives: ReadonlyMap<string, ReadonlySet<string>>): string[] {
  return ouvertes
    .filter((a) => {
      const actifs = conditionsActives.get(a.type);
      return Boolean(actifs) && Boolean(a.related_id) && !actifs!.has(a.related_id!);
    })
    .map((a) => a.id);
}
