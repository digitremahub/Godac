/**
 * Sécurité routière de « Go! » : pas de saisie au-dessus de 15 km/h
 * (mêmes seuils que l'écran de conduite épuré : 15 km/h pour passer en
 * mouvement, 8 km/h pour revenir à l'arrêt). Logique pure, testée.
 */
import { SEUIL_ARRET_KMH, SEUIL_MOUVEMENT_KMH, enMouvementApres } from "@/lib/colis/epure-conduite";

export { SEUIL_ARRET_KMH, SEUIL_MOUVEMENT_KMH };
export const MESSAGE_SAISIE_BLOQUEE = "Arrêtez-vous pour saisir une destination";

/** Mouvement après un relevé de vitesse (hystérésis 15 / 8 km/h). */
export const mouvementApres = enMouvementApres;

/** Le clavier et la recherche sont bloqués tant que le véhicule roule. */
export const saisieBloquee = (mouvement: boolean): boolean => mouvement;

export const CLE_AVERTISSEMENT = "godac.go-aller-a.avertissement";
export const TEXTE_AVERTISSEMENT = "Utilisez « Go! » à l'arrêt, avant de partir. La saisie est bloquée dès que vous roulez. Respectez le code de la route et la signalisation : le guidage est une aide, il ne remplace pas votre vigilance.";

/** Avertissement d'usage prudent : montré une seule fois par appareil. */
export const avertissementDejaVu = (valeur: string | null | undefined): boolean => valeur === "1";
