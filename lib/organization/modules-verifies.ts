/**
 * Mémoire de courte durée des modules déjà vérifiés par garderApi
 * (lib/acces/garde-api.ts). Les handlers de l'API colis rappelaient
 * `moduleActif` juste après la garde, soit deux requêtes de plus à chaque
 * appel (organization_modules + organizations) pour un résultat identique.
 * Valeur gardée quelques secondes seulement, par instance : la garde de
 * chaque requête relit toujours la base, ce cache ne sert qu'au second
 * contrôle de la même requête.
 */
export const VALIDITE_MODULE_VERIFIE_MS = 5000;
const CLES_MAX = 2000;

const verifies = new Map<string, { actif: boolean; expire: number }>();

const cle = (organizationId: string, module: string) => `${organizationId}:${module}`;

export function memoriserModule(organizationId: string, module: string, actif: boolean, maintenant: number = Date.now()): void {
  if (verifies.size >= CLES_MAX) {
    for (const [k, v] of verifies) if (v.expire <= maintenant) verifies.delete(k);
    if (verifies.size >= CLES_MAX) verifies.clear();
  }
  verifies.set(cle(organizationId, module), { actif, expire: maintenant + VALIDITE_MODULE_VERIFIE_MS });
}

/** Résultat vérifié il y a quelques secondes, ou null s'il faut relire la base. */
export function moduleDejaVerifie(organizationId: string, module: string, maintenant: number = Date.now()): boolean | null {
  const v = verifies.get(cle(organizationId, module));
  return v && v.expire > maintenant ? v.actif : null;
}

export function viderModulesVerifies(): void {
  verifies.clear();
}
