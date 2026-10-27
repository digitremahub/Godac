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

/**
 * Alertes de tournée créées par la surveillance (retard, non démarrée, sans
 * chauffeur) : elles nomment un chauffeur. Réservées à l'encadrement du
 * service concerné (exploitation et direction : toute l'organisation) ; une
 * tournée sans service n'est visible que de l'exploitation et de la
 * direction, comme dans le suivi (tourneesDuPerimetre), jamais d'un manager
 * d'un autre service ni du comptable.
 */
export const TYPES_ALERTE_TOURNEE: readonly string[] = ["tournee_retard", "tournee_non_demarree", "tournee_sans_chauffeur"];

/**
 * Même périmètre pour les échéances de la flotte (contrôle technique,
 * assurance, amende : cron /api/cron/echeances-flotte) : encadrement du
 * service du véhicule, exploitation et direction pour toute l'organisation ;
 * jamais le comptable ni le chauffeur ; un véhicule sans service reste à
 * l'exploitation et à la direction.
 */
export const TYPES_ALERTE_ECHEANCE: readonly string[] = ["echeance_vehicule"];

/**
 * Alertes RH (lot 3) : échéances du personnel (permis, visite médicale, fin de
 * contrat, documents) et pointages à régulariser. Même périmètre : un manager
 * ne reçoit que celles de son service ; les genres sensibles (visite médicale,
 * fin de contrat, titre de séjour) sont créés sans service et ne lui arrivent
 * jamais (lib/alerts/echeances-rh.ts) ; jamais le comptable ni le chauffeur.
 */
export const TYPES_ALERTE_RH: readonly string[] = ["echeance_rh", "pointage_a_regulariser"];

/** Alertes de facturation (paiement échoué) : la direction seule. */
export const TYPES_ALERTE_DIRECTION: readonly string[] = ["paiement_echoue"];

/** Alertes réservées à l'encadrement et bornées au service : tournées, échéances de la flotte et alertes RH. */
const TYPES_ALERTE_ENCADREMENT_SERVICE: readonly string[] = [...TYPES_ALERTE_TOURNEE, ...TYPES_ALERTE_ECHEANCE, ...TYPES_ALERTE_RH];

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
 * Le rôle peut-il voir/recevoir une alerte de ce type et de ce service ?
 * (miroir de la RLS, migration 20261107000001). Seules les alertes de
 * tournée sont encadrées ici ; le reste suit la RLS d'origine.
 */
export function alerteVisiblePour(role: string, type: string, serviceId: string | null | undefined, mesServices: readonly string[] = []): boolean {
  if (TYPES_ALERTE_DIRECTION.includes(type)) return role === "direction";
  if (!TYPES_ALERTE_ENCADREMENT_SERVICE.includes(type)) return true;
  if (role === "comptable" || role === "chauffeur") return false;
  if (ROLES_PAR_SERVICE.includes(role)) return Boolean(serviceId) && mesServices.includes(serviceId!);
  return true;
}

/**
 * Destinataires retenus parmi `candidats` (déjà limités à l'organisation et
 * aux rôles ciblés). `servicesDe` : services de chaque candidat (utile aux
 * managers seulement). Un manager sans service connu ne reçoit pas une
 * alerte de service.
 */
export function choisirDestinataires<T extends DestinatairePossible>(
  candidats: readonly T[],
  alerte: { service_id?: string | null; type?: string },
  servicesDe: ReadonlyMap<string, readonly string[]>,
): T[] {
  const tournee = TYPES_ALERTE_ENCADREMENT_SERVICE.includes(alerte.type ?? "");
  return candidats.filter((c) => {
    if (tournee) return alerteVisiblePour(c.role, alerte.type!, alerte.service_id, servicesDe.get(c.id) ?? []);
    return !estLimiteAuService(c.role, alerte.service_id) || (servicesDe.get(c.id) ?? []).includes(alerte.service_id!);
  });
}

/**
 * Filet de lecture, en plus de la RLS (migration 20261107000001, pas
 * forcément appliquée) : alertes de tournée que ce rôle ne doit pas voir.
 * La RLS a déjà limité un manager à ses services : seul compte ici le
 * rattachement à un service.
 */
export function alerteAffichable(role: string, a: { type: string; service_id?: string | null }): boolean {
  return alerteVisiblePour(role, a.type, a.service_id, a.service_id ? [a.service_id] : []);
}

/** Managers dont les services sont à lire : ceux d'une alerte de service ou d'une alerte de tournée. */
export function serviceAVerifier(role: string, type: string, serviceId: string | null | undefined): boolean {
  return ROLES_PAR_SERVICE.includes(role) && (Boolean(serviceId) || TYPES_ALERTE_ENCADREMENT_SERVICE.includes(type));
}

/**
 * Qui peut changer le statut partagé d'une alerte (PATCH /api/alerts/[id]) :
 *  - « traitée » (resolved) et « prise en compte » (acknowledged) : manager
 *    (alertes de ses services), exploitation, direction ; jamais le chauffeur
 *    ni le comptable (hors chaîne de décision) ;
 *  - un chauffeur ou un comptable peut seulement prendre en compte SES
 *    alertes personnelles (recipient_user_id), jamais les résoudre.
 * Revérifié côté serveur en plus de la RLS.
 */
export function peutChangerStatutAlerte(p: {
  role: string;
  userId: string;
  statut: "acknowledged" | "resolved";
  alerte: { type: string; service_id?: string | null; recipient_user_id?: string | null };
  mesServices: readonly string[];
}): { ok: true } | { ok: false; raison: string } {
  const { role, alerte } = p;
  if (alerte.recipient_user_id) {
    if (alerte.recipient_user_id !== p.userId) return { ok: false, raison: "Cette notification ne vous est pas destinée." };
    if (role === "chauffeur" || role === "comptable") {
      return p.statut === "acknowledged" ? { ok: true } : { ok: false, raison: "Seule l'encadrement peut résoudre une notification." };
    }
    return { ok: true };
  }
  if (!["manager", "exploitation", "direction"].includes(role)) return { ok: false, raison: "Seule l'encadrement peut traiter une notification." };
  if (ROLES_PAR_SERVICE.includes(role) && alerte.service_id && !p.mesServices.includes(alerte.service_id)) {
    return { ok: false, raison: "Cette notification concerne un autre service." };
  }
  if (!alerteVisiblePour(role, alerte.type, alerte.service_id, p.mesServices)) return { ok: false, raison: "Cette notification n'est pas dans votre périmètre." };
  return { ok: true };
}
