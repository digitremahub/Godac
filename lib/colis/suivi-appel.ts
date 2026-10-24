/**
 * Après un appel lancé depuis l'application (bouton « Appeler »), au retour
 * dans GODAC on propose — sans bloquer — de cocher « Eu au téléphone ».
 * Le suivi attend que l'application ait réellement quitté l'écran (le
 * composeur du téléphone s'est ouvert) avant de proposer.
 */
const OUBLI_MS = 2 * 3_600_000;
const RETOUR_MIN_MS = 2000;

export function creerSuiviAppel(horloge: () => number = Date.now) {
  let appel: { stopId: string; t: number; parti: boolean } | null = null;
  return {
    lancer(stopId: string) {
      appel = { stopId, t: horloge(), parti: false };
    },
    /** L'application passe en arrière-plan. */
    aQuitte() {
      if (appel) appel.parti = true;
    },
    /** Retour dans l'application : l'arrêt à proposer, une seule fois ; null sinon. */
    auRetour(): string | null {
      if (!appel || !appel.parti) return null;
      const ecoule = horloge() - appel.t;
      const { stopId } = appel;
      if (ecoule < RETOUR_MIN_MS) return null;
      appel = null;
      return ecoule <= OUBLI_MS ? stopId : null;
    },
    oublier() {
      appel = null;
    },
  };
}
