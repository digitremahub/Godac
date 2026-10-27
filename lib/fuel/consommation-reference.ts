/**
 * Consommation de référence d'un véhicule (vehicles.reference_consumption_l_100km,
 * saisie à la création ou estimée) : alerte douce quand la consommation mesurée
 * sur les 30 derniers jours la dépasse de plus de SEUIL_ECART_CONSOMMATION_REFERENCE.
 * Distincte de l'anomalie « 30 jours contre 90 jours » du trigger de la base
 * (migration 121), qui compare le véhicule à lui-même : celle-ci le compare à ce
 * que son constructeur ou son exploitant annonce.
 *
 * Fichier pur, testé dans lib/fuel/__tests__/consommation-reference.test.ts ;
 * le cron (app/api/cron/echeances-flotte) lit les mesures et crée l'alerte.
 */

/** Écart relatif au-delà duquel la consommation est signalée (0,25 = +25 % par rapport à la référence). */
export const SEUIL_ECART_CONSOMMATION_REFERENCE = 0.25;

/** Fenêtre de mesure de la consommation, en jours. */
export const FENETRE_CONSOMMATION_REFERENCE_JOURS = 30;

export interface EcartReference {
  /** Écart en % de la référence (positif : au-dessus), arrondi à 0,1. */
  ecartPourcent: number;
  anomalie: boolean;
}

/** Écart à la référence ; null si la mesure ou la référence manque ou n'est pas exploitable. */
export function ecartConsommationReference(mesuree: number | null | undefined, reference: number | string | null | undefined, seuil: number = SEUIL_ECART_CONSOMMATION_REFERENCE): EcartReference | null {
  const ref = reference === null || reference === undefined || reference === "" ? NaN : Number(reference);
  if (mesuree === null || mesuree === undefined || !Number.isFinite(mesuree) || mesuree <= 0 || !Number.isFinite(ref) || ref <= 0) return null;
  const ecart = (mesuree - ref) / ref;
  return { ecartPourcent: Math.round(ecart * 1000) / 10, anomalie: ecart > seuil };
}

/** Une alerte par véhicule et par mois : la clé de dédoublonnage porte le mois (AAAA-MM). */
export function cleConsommationReference(vehicleId: string, jour: string): string {
  return `conso_ref:${vehicleId}:${jour.slice(0, 7)}`;
}

export function messageConsommationReference(params: { registration: string; mesuree: number; reference: number; ecartPourcent: number; jours?: number }): string {
  const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `Consommation de ${params.registration} : ${fr(params.mesuree)} L/100 km sur ${params.jours ?? FENETRE_CONSOMMATION_REFERENCE_JOURS} jours, soit ${fr(params.ecartPourcent)} % au-dessus de la référence du véhicule (${fr(params.reference)} L/100 km). À regarder : charge, pneus, conduite, fuite, relevés de kilométrage.`;
}
