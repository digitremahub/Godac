/**
 * Module « Véhicules loués (loueurs) » — cycle de vie d'une demande
 * d'entretien transmise au loueur (table rental_maintenance_requests).
 * Fonctions pures, testées (lib/rental/__tests__/workflow.test.ts) :
 * c'est la seule source de vérité des transitions autorisées, côté API
 * comme côté page prestataire.
 */

export const RENTAL_REQUEST_STATUSES = ["a_valider", "validee", "transmise", "planifiee", "terminee", "refusee"] as const;
export type RentalRequestStatus = (typeof RENTAL_REQUEST_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Record<RentalRequestStatus, string> = {
  a_valider: "À valider",
  validee: "Validée (non transmise)",
  transmise: "Transmise au prestataire",
  planifiee: "Planifiée",
  terminee: "Terminée",
  refusee: "Refusée",
};

export const RENTAL_STATUS_BADGES: Record<RentalRequestStatus, string> = {
  a_valider: "badge-gold",
  validee: "badge-neutral",
  transmise: "badge-teal",
  planifiee: "badge-teal",
  terminee: "badge-neutral",
  refusee: "badge-orange",
};

export const OWNERSHIP_LABELS = {
  propre: "En propre",
  location: "Location courte durée",
  location_longue_duree: "Location longue durée (LLD)",
  credit_bail: "Crédit-bail / LOA",
} as const;
export type VehicleOwnership = keyof typeof OWNERSHIP_LABELS;

export const PROVIDER_KIND_LABELS = {
  loueur: "Loueur",
  garage: "Garage prestataire",
  loueur_entretien: "Loueur avec entretien inclus",
} as const;
export type ProviderKind = keyof typeof PROVIDER_KIND_LABELS;

export function isRentedOwnership(ownership: string | null | undefined): boolean {
  return Boolean(ownership) && ownership !== "propre";
}

/** Actions côté entreprise (responsable/direction). */
export type ManagerAction = "valider" | "refuser" | "transmettre" | "terminer";
/** Actions côté prestataire, via le lien sécurisé. */
export type ProviderAction = "accepter" | "proposer_creneau" | "commenter" | "terminer";

const MANAGER_ALLOWED: Record<ManagerAction, RentalRequestStatus[]> = {
  valider: ["a_valider"],
  refuser: ["a_valider", "validee"],
  // (Re)transmission : premier envoi après validation, ou renvoi d'un
  // nouveau lien (le précédent est alors révoqué).
  transmettre: ["validee", "transmise", "planifiee"],
  // Clôture manuelle quand le prestataire n'utilise pas le lien.
  terminer: ["transmise", "planifiee"],
};

const PROVIDER_ALLOWED: Record<ProviderAction, RentalRequestStatus[]> = {
  accepter: ["transmise", "planifiee"],
  proposer_creneau: ["transmise", "planifiee"],
  commenter: ["transmise", "planifiee"],
  terminer: ["transmise", "planifiee"],
};

export function canManagerAct(status: RentalRequestStatus, action: ManagerAction): boolean {
  return MANAGER_ALLOWED[action].includes(status);
}

export function canProviderAct(status: RentalRequestStatus, action: ProviderAction): boolean {
  return PROVIDER_ALLOWED[action].includes(status);
}

/** Statut atteint après une action, ou null si l'action est interdite dans ce statut. */
export function nextStatusAfterManager(status: RentalRequestStatus, action: ManagerAction, emailSent = true): RentalRequestStatus | null {
  if (!canManagerAct(status, action)) return null;
  switch (action) {
    case "valider":
      return "validee";
    case "refuser":
      return "refusee";
    case "transmettre":
      // Sans e-mail parti (pas d'adresse, envoi désactivé), la demande
      // reste « validée » : le responsable transmet le lien lui-même.
      if (status === "validee") return emailSent ? "transmise" : "validee";
      return status;
    case "terminer":
      return "terminee";
  }
}

export function nextStatusAfterProvider(
  status: RentalRequestStatus,
  action: ProviderAction,
  opts: { hasSlot?: boolean } = {},
): RentalRequestStatus | null {
  if (!canProviderAct(status, action)) return null;
  switch (action) {
    case "accepter":
      return opts.hasSlot ? "planifiee" : status;
    case "proposer_creneau":
      return "planifiee";
    case "commenter":
      return status;
    case "terminer":
      return "terminee";
  }
}

export function isTerminal(status: RentalRequestStatus): boolean {
  return status === "terminee" || status === "refusee";
}

export const PROVIDER_ACTION_LABELS: Record<ProviderAction, string> = {
  accepter: "a accepté la demande",
  proposer_creneau: "a proposé un créneau",
  commenter: "a ajouté un commentaire",
  terminer: "a indiqué l'intervention terminée",
};

export const EVENT_LABELS: Record<string, string> = {
  creation: "Demande ouverte (véhicule loué)",
  valider: "Validée par un responsable",
  refuser: "Refusée",
  transmettre: "Transmise au prestataire",
  terminer: "Clôturée",
  accepter: "Acceptée par le prestataire",
  proposer_creneau: "Créneau proposé par le prestataire",
  commenter: "Commentaire",
  facture: "Facture / document déposé",
};
