/**
 * Lecture des notifications, par personne (table alert_reads, migration
 * 20260101000099) : une alerte destinée à un rôle a un seul statut partagé
 * (ouverte, prise en compte, résolue), mais « lu » reste propre à chacun.
 * Fichier pur : utilisé par les accueils, le centre de notifications et la
 * cloche, et testé dans lib/alerts/__tests__.
 */

/** Gravité d'une alerte, en clair. */
export const LIBELLES_GRAVITE: Record<string, string> = {
  info: "Info",
  warning: "À surveiller",
  critical: "Urgent",
};

/**
 * Statut partagé d'une alerte, en clair. Trois choses distinctes :
 *  - « lue » : propre à chaque personne (alert_reads), ne dit rien du travail ;
 *  - « ouverte » : personne ne l'a encore prise en charge ; seule cette
 *    étape compte dans « Notifications ouvertes » de la direction ;
 *  - « traitée » : résolue à la main ou clôturée toute seule quand sa
 *    condition a disparu (lib/alerts/cloture.ts).
 */
export const LIBELLES_STATUT_ALERTE: Record<string, string> = {
  open: "Ouverte",
  acknowledged: "Pris en compte",
  resolved: "Traitée",
};

export const libelleGravite = (g: string) => LIBELLES_GRAVITE[g] ?? "Info";
export const libelleStatutAlerte = (s: string) => LIBELLES_STATUT_ALERTE[s] ?? s;

export type EtatAlerte = "nouvelle" | "lue" | "prise_en_compte" | "traitee";

/** Où en est l'alerte pour cette personne : non lue, lue mais encore ouverte, prise en compte, traitée. */
export function etatAlerte(statut: string, lu: boolean | undefined): EtatAlerte {
  if (statut === "resolved") return "traitee";
  if (statut === "acknowledged") return "prise_en_compte";
  return lu === false ? "nouvelle" : "lue";
}

/** Seules les alertes ouvertes restent à traiter (compteur de la direction). */
export const resteATraiter = (statut: string) => statut === "open";

/**
 * Filtre PostgREST des alertes qu'une personne doit voir : les alertes
 * diffusées (sans destinataire) et ses alertes personnelles, jamais le
 * rappel personnel d'un collègue que la RLS laisserait lire à
 * l'encadrement (même règle que la cloche).
 */
export function filtreDestinataire(userId: string): string {
  return `recipient_user_id.is.null,recipient_user_id.eq.${userId}`;
}

/** Alertes marquées lues ou non pour cette personne. */
export function marquerLues<T extends { id: string }>(alertes: readonly T[], lues: Iterable<string>): (T & { lu: boolean })[] {
  const set = new Set(lues);
  return alertes.map((a) => ({ ...a, lu: set.has(a.id) }));
}

/** Non lues d'abord, puis de la plus récente à la plus ancienne. */
export function trierNonLuesDabord<T extends { lu?: boolean; created_at: string }>(alertes: readonly T[]): T[] {
  return [...alertes].sort((a, b) => Number(Boolean(a.lu)) - Number(Boolean(b.lu)) || b.created_at.localeCompare(a.created_at));
}

/** Nombre d'alertes non lues parmi celles visibles. */
export function compterNonLues(ids: readonly string[], lues: Iterable<string>): number {
  const set = new Set(lues);
  return ids.filter((id) => !set.has(id)).length;
}
