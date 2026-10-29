/**
 * Destinations récentes de GO (« Aller à… », table go_lieux, genre « recent ») :
 * 90 jours après le dernier usage, puis supprimées par le cron retention
 * existant (quotidien). Les favoris restent jusqu'à ce que l'utilisateur les
 * supprime (ou que son compte / son organisation soit effacé, en cascade).
 * Durée à garder alignée avec app/confidentialite et app/dpa.
 */
export const GO_LIEUX_RECENTS_JOURS = 90;

/** Instant limite : tout récent dont le dernier usage est plus ancien est supprimé. */
export function limiteLieuxRecents(maintenant: Date = new Date()): string {
  return new Date(maintenant.getTime() - GO_LIEUX_RECENTS_JOURS * 86_400_000).toISOString();
}
