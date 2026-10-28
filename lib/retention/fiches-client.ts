// Purge RGPD des fiches client de l'annuaire (delivery_address_hours), partie pure
// (testée dans lib/retention/__tests__/fiches-client.test.ts).
//
// La page de confidentialité annonce : « Fiches client de l'annuaire (téléphone,
// contact, consignes d'accès, statistiques de passage) : 12 mois sans mise à jour ».
// Une fiche est « mise à jour » quand un arrêt à cette adresse est clôturé ou
// qu'une personne la modifie (updated_at). Passé ce délai :
//  - une fiche SANS horaires d'ouverture (créée automatiquement) est supprimée ;
//  - une fiche AVEC horaires (saisie ou trouvée pour l'optimisation) garde son nom,
//    son adresse et ses horaires d'ouverture (données d'entreprise), mais perd
//    téléphone, contact, consignes et statistiques de passage.
// Le sens de tournée (tournee_sens) ne contient que des noms de villages : il suit
// le même délai pour ne pas garder une habitude périmée.

/** Durée annoncée : 12 mois sans mise à jour. */
export const RETENTION_FICHES_CLIENT_JOURS = 365;

/** Instant (ISO) avant lequel une mise à jour est assez ancienne pour purger. */
export function limiteFichesClient(maintenant: Date = new Date()): string {
  return new Date(maintenant.getTime() - RETENTION_FICHES_CLIENT_JOURS * 86_400_000).toISOString();
}

/** Colonnes remises à zéro quand on anonymise une fiche conservée pour ses horaires. */
export const COLONNES_CLIENT_EFFACEES = {
  phone: null,
  recipient: null,
  access_notes: null,
  lat: null,
  lng: null,
  window_start: null,
  window_end: null,
  service_avg_min: null,
  service_samples: 0,
  delivered_count: 0,
  failed_count: 0,
  success_by_hour: {},
  failure_reasons: {},
  contact_message_count: 0,
  contact_phone_count: 0,
  last_delivery_at: null,
} as const;

export interface FichePurgeable {
  updated_at: string;
  weekly_schedule: unknown;
}

const aDesHoraires = (f: { weekly_schedule: unknown }) => Boolean(f.weekly_schedule && typeof f.weekly_schedule === "object" && Object.keys(f.weekly_schedule as object).length > 0);

/** Que faire d'une fiche : la garder, la supprimer (sans horaires) ou l'anonymiser (avec horaires). */
export function decisionFiche(f: FichePurgeable, maintenant: Date = new Date()): "garder" | "supprimer" | "anonymiser" {
  if (f.updated_at >= limiteFichesClient(maintenant)) return "garder";
  return aDesHoraires(f) ? "anonymiser" : "supprimer";
}
