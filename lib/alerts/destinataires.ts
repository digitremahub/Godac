/**
 * Destinataires d'une alerte pour l'e-mail et le push (webhook
 * app/api/webhooks/supabase-alerts). Fichier pur, testé dans
 * lib/alerts/__tests__/destinataires.test.ts.
 *
 * Même périmètre que la RLS des alertes (migration 20260101000078) :
 *  - manager : seulement les alertes de ses services quand l'alerte est
 *    rattachée à un service (alerts.service_id) ; sans service, tous ;
 *  - exploitation, direction, comptable : toute l'organisation.
 */
import { rolesDestinatairesEffectifs } from "@/lib/roles/perimetre";

export interface DestinatairePossible {
  id: string;
  role: string;
}

/** Rôles limités à leurs services. */
const ROLES_PAR_SERVICE: readonly string[] = ["manager", "manager_chauffeur"];

export const ROLES_PAR_DEFAUT = ["direction", "exploitation"];

/** Rôles dont les comptes sont à lire pour cette alerte. */
export function rolesCibles(recipientRoles: readonly string[]): string[] {
  return recipientRoles.length > 0 ? rolesDestinatairesEffectifs(recipientRoles) : ROLES_PAR_DEFAUT;
}

/** Un rôle d'encadrement de service est limité à ses services quand l'alerte en a un. */
export function estLimiteAuService(role: string, serviceId: string | null | undefined): boolean {
  return Boolean(serviceId) && ROLES_PAR_SERVICE.includes(role);
}

/**
 * Destinataires retenus parmi `candidats` (déjà limités à l'organisation et
 * aux rôles ciblés). `servicesDe` : services de chaque candidat (utile aux
 * managers seulement). Un manager sans service connu ne reçoit pas une
 * alerte de service.
 */
export function choisirDestinataires<T extends DestinatairePossible>(
  candidats: readonly T[],
  alerte: { service_id?: string | null },
  servicesDe: ReadonlyMap<string, readonly string[]>,
): T[] {
  return candidats.filter((c) => !estLimiteAuService(c.role, alerte.service_id) || (servicesDe.get(c.id) ?? []).includes(alerte.service_id!));
}
