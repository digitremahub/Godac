/**
 * Clôture des arrêts d'une tournée, dans n'importe quel ordre : le
 * chauffeur peut livrer (ou noter un échec sur) une adresse qui n'est
 * pas la suivante. Le « prochain » arrêt reste le premier non clôturé
 * dans l'ordre de passage ; un arrêt clôturé sort des restants.
 */

export type StatutArret = "pending" | "delivered" | "failed";

/** Motifs d'échec proposés au chauffeur (colonne delivery_stops.failure_reason). */
export const MOTIFS_ECHEC = [
  { key: "absent", label: "Client absent" },
  { key: "adresse_introuvable", label: "Adresse introuvable" },
  { key: "acces_impossible", label: "Accès impossible" },
  { key: "ferme", label: "Fermé" },
  { key: "refuse", label: "Colis refusé" },
  { key: "rien_a_ramasser", label: "Rien à ramasser" },
  { key: "relais_complet", label: "Relais complet / refus" },
  { key: "autre", label: "Autre motif" },
] as const;

export type MotifEchec = (typeof MOTIFS_ECHEC)[number]["key"];

export const libelleMotif = (motif: string | null | undefined) => MOTIFS_ECHEC.find((m) => m.key === motif)?.label ?? null;

/** Motifs propres à un type d'arrêt (absents des autres types). */
const MOTIFS_DU_TYPE: Record<string, readonly MotifEchec[]> = {
  livraison: ["absent", "refuse"],
  ramasse: ["absent", "rien_a_ramasser"],
  point_relais: ["relais_complet"],
};
const MOTIFS_SPECIFIQUES = new Set(Object.values(MOTIFS_DU_TYPE).flat());

/**
 * Motifs pertinents selon le type d'arrêt : « Colis refusé » pour une
 * livraison, « Rien à ramasser » pour une ramasse, « Relais complet /
 * refus » (et pas « Client absent ») pour un point relais. Un booléen
 * vaut ramasse (true) ou livraison (false).
 */
export function motifsPour(type: boolean | "livraison" | "ramasse" | "point_relais") {
  const t = type === true ? "ramasse" : type === false ? "livraison" : type;
  const propres = MOTIFS_DU_TYPE[t] ?? [];
  return MOTIFS_ECHEC.filter((m) => !MOTIFS_SPECIFIQUES.has(m.key) || propres.includes(m.key));
}

export const estClos = (s: { status: string }) => s.status !== "pending";

/** Arrêts encore à faire, dans l'ordre de passage (l'ordre du tableau). */
export function arretsRestants<T extends { status: string }>(stops: T[]): T[] {
  return stops.filter((s) => !estClos(s));
}

/** Prochain arrêt : le premier non clôturé dans l'ordre, quels que soient ceux clôturés hors ordre. */
export function prochainArret<T extends { status: string }>(stops: T[]): T | null {
  return stops.find((s) => !estClos(s)) ?? null;
}

/** Arrêts clôturés avant leur tour : faits alors qu'un arrêt placé avant eux est encore à faire. */
export function cloturesHorsOrdre<T extends { status: string }>(stops: T[]): T[] {
  const premier = stops.findIndex((s) => !estClos(s));
  return premier < 0 ? [] : stops.slice(premier + 1).filter(estClos);
}

/**
 * Contrôle d'un changement de statut : on ne clôture qu'un arrêt encore à
 * faire (pas de double clôture) ; on n'annule (remise à faire) qu'un arrêt
 * clôturé. Aucune contrainte d'ordre. Renvoie le message d'erreur, ou null.
 */
export function refusCloture(actuel: string, demande: StatutArret): string | null {
  if (demande === "pending") return actuel === "pending" ? "Cet arrêt est déjà à faire." : null;
  if (actuel !== "pending") return "Arrêt déjà clôturé : annulez d'abord la clôture pour le modifier.";
  return null;
}
