/**
 * Pôles standard de toute entreprise GODAC. Un pôle regroupe des
 * services (table `services`, colonne `pole`) :
 *
 * - `exploitation` : les services transport historiques (dépôt,
 *   tournées, chauffeurs, véhicules) — autant que l'entreprise veut,
 *   librement créés, renommés, supprimés ;
 * - tous les autres : les pôles « bureau » (direction, secrétariat,
 *   comptabilité…), identiques pour toutes les entreprises, créés
 *   d'office (migration 20260101000126 + api/onboarding/create-organization)
 *   à raison d'un service par pôle. Renommables, jamais supprimables.
 *
 * Les gens des bureaux sont rattachés à leur pôle par le même lien
 * user_services que les chauffeurs à leur service, et leur planning
 * est un planning de présence (horaires), pas de tournées — voir
 * PRESENCE_STATUS ci-dessous.
 *
 * La liste doit rester alignée sur la contrainte check de
 * services.pole (migration 20260101000126).
 */
export type PoleKey =
  | "exploitation"
  | "direction"
  | "administratif"
  | "secretariat"
  | "comptabilite"
  | "rh"
  | "atelier"
  | "commercial"
  | "qualite";

/** Icône de components/layout/icons.tsx (nom sans le préfixe `Icon`) — gardé en texte pour que ce module reste sans React. */
export type PoleIcon = "Truck" | "Building" | "FileText" | "Message" | "Coins" | "Users" | "Wrench" | "ChartBar" | "ShieldCheck";

export interface Pole {
  key: PoleKey;
  label: string;
  /** Une ligne affichée sous le titre du pôle (Organisation, fiche salarié). */
  description: string;
  icon: PoleIcon;
  /** Pastille de couleur (fond) — classes Tailwind du thème. */
  dotClass: string;
  /** Pôle transport (tournées/véhicules) ou pôle bureau (présence). */
  operationnel: boolean;
}

export const POLES: readonly Pole[] = [
  { key: "exploitation", label: "Exploitation", description: "Services transport : dépôts, tournées, chauffeurs, véhicules.", icon: "Truck", dotClass: "bg-teal", operationnel: true },
  { key: "direction", label: "Direction", description: "Gérance, direction générale.", icon: "Building", dotClass: "bg-marine", operationnel: false },
  { key: "administratif", label: "Administratif", description: "Gestion administrative, dossiers, contrats.", icon: "FileText", dotClass: "bg-navy/40", operationnel: false },
  { key: "secretariat", label: "Secrétariat", description: "Accueil, standard, courrier.", icon: "Message", dotClass: "bg-gold", operationnel: false },
  { key: "comptabilite", label: "Comptabilité", description: "Facturation, comptabilité, paie.", icon: "Coins", dotClass: "bg-gold/60", operationnel: false },
  { key: "rh", label: "Ressources humaines", description: "Recrutement, formation, relations sociales.", icon: "Users", dotClass: "bg-orange", operationnel: false },
  { key: "atelier", label: "Atelier / maintenance", description: "Entretien et réparation du parc.", icon: "Wrench", dotClass: "bg-orange/60", operationnel: false },
  { key: "commercial", label: "Commercial", description: "Clients, devis, appels d'offres.", icon: "ChartBar", dotClass: "bg-teal/60", operationnel: false },
  { key: "qualite", label: "Qualité, sécurité, environnement", description: "QSE, prévention, conformité.", icon: "ShieldCheck", dotClass: "bg-navy/70", operationnel: false },
];

export const POLE_KEYS = POLES.map((p) => p.key) as readonly PoleKey[];

/** Pôles bureau, créés d'office dans chaque entreprise (un service chacun). */
export const POLES_BUREAU = POLES.filter((p) => !p.operationnel);

export function estPole(value: unknown): value is PoleKey {
  return typeof value === "string" && (POLE_KEYS as readonly string[]).includes(value);
}

/** Pôle d'une valeur venue de la base — `exploitation` par défaut (colonne absente, valeur inconnue). */
export function poleDe(value: unknown): Pole {
  return POLES.find((p) => p.key === value) ?? POLES[0]!;
}

export function estPoleBureau(value: unknown): boolean {
  return !poleDe(value).operationnel;
}

/**
 * Regroupe des services par pôle, dans l'ordre de POLES ; les pôles
 * sans service sont omis. L'ordre des services dans un pôle est
 * conservé (la requête les trie déjà par nom).
 */
export function grouperParPole<T extends { pole?: string | null }>(services: T[]): { pole: Pole; services: T[] }[] {
  return POLES.map((pole) => ({ pole, services: services.filter((s) => poleDe(s.pole).key === pole.key) })).filter((g) => g.services.length > 0);
}

/** Libellé « Pôle · Service » — juste le nom quand il est identique au libellé du pôle (service créé d'office). */
export function libelleServiceAvecPole(service: { name: string; pole?: string | null }): string {
  const pole = poleDe(service.pole);
  if (pole.operationnel) return service.name;
  return service.name === pole.label ? pole.label : `${pole.label} · ${service.name}`;
}

/**
 * Planning de présence (pôles bureau) : une ligne planning_entries par
 * personne et par jour, sans véhicule, avec kind = 'presence' et
 * status = 'presence'. Ce statut hors du cycle des tournées
 * (planned → in_progress → done) tient ces lignes à l'écart de tout
 * ce qui ne lit que des tournées (démarrage, rapports, historique,
 * kilométrage, TICPE, alertes d'affectation du trigger
 * after_planning_entry_upsert, qui ne réagit qu'à 'planned').
 */
export const PRESENCE_STATUS = "presence";
export const PRESENCE_KIND = "presence";

/**
 * tour_number est `not null` et entre dans la contrainte unique
 * (organization_id, service_id, tour_number, start_at) : un repère
 * stable par personne évite qu'une deuxième personne arrivant à la
 * même heure dans le même pôle tombe sur un doublon. "PRESENCE-" fait
 * 8 caractères + tiret, le même motif que les numéros automatiques
 * (`________-%`) que les suggestions de tournées excluent déjà.
 */
export function numeroPresence(userId: string): string {
  return `PRESENCE-${userId}`;
}

export function estPresence(entry: { kind?: string | null; status?: string | null; tour_number?: string | null }): boolean {
  return entry.kind === PRESENCE_KIND || entry.status === PRESENCE_STATUS || Boolean(entry.tour_number?.startsWith("PRESENCE-"));
}

/** Libellé court d'une ligne de planning : « n°T106 » pour une tournée, « Présence » pour un pôle bureau. */
export function libelleEntreePlanning(entry: { kind?: string | null; status?: string | null; tour_number: string }): string {
  return estPresence(entry) ? "Présence" : `n°${entry.tour_number}`;
}

/** Durée d'une présence en heures (0 si fin absente ou avant le début). */
export function heuresPresence(startAt: string, endAt: string | null): number {
  if (!endAt) return 0;
  const h = (Date.parse(endAt) - Date.parse(startAt)) / 3_600_000;
  return Number.isFinite(h) && h > 0 ? Math.round(h * 100) / 100 : 0;
}
