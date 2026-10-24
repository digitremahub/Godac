/**
 * Retrait d'une adresse en un geste, avec annulation : l'arrêt disparaît tout
 * de suite, mais la suppression n'est envoyée qu'après ce délai — « Annuler »
 * dans le message le remet, sans rien avoir supprimé. Pas de confirmation.
 */
export const DELAI_ANNULATION_MS = 6000;

export function creerRetraitsDifferes() {
  const enAttente = new Map<string, { minuterie: ReturnType<typeof setTimeout>; envoyer: () => void | Promise<void> }>();
  return {
    /** Programme l'envoi du retrait de `id` (remplace un retrait déjà en attente). */
    planifier(id: string, envoyer: () => void | Promise<void>, delaiMs = DELAI_ANNULATION_MS) {
      const ancien = enAttente.get(id);
      if (ancien) clearTimeout(ancien.minuterie);
      const minuterie = setTimeout(() => {
        enAttente.delete(id);
        void envoyer();
      }, delaiMs);
      enAttente.set(id, { minuterie, envoyer });
    },
    /** Annule le retrait : true s'il était encore en attente (rien n'a été envoyé). */
    annuler(id: string): boolean {
      const r = enAttente.get(id);
      if (!r) return false;
      clearTimeout(r.minuterie);
      enAttente.delete(id);
      return true;
    },
    enAttente: (id: string) => enAttente.has(id),
    /** Envoie tout de suite les retraits en attente (fermeture de l'écran, passage en arrière-plan). */
    async vider() {
      const tous = [...enAttente.entries()];
      enAttente.clear();
      await Promise.all(
        tous.map(([, r]) => {
          clearTimeout(r.minuterie);
          return r.envoyer();
        }),
      );
    },
  };
}

/** Arrêts sans ceux dont le retrait est en attente (l'annulation les remet à leur place d'origine). */
export function sansRetraits<T extends { id: string }>(stops: T[], retires: ReadonlySet<string>): T[] {
  return retires.size ? stops.filter((s) => !retires.has(s.id)) : stops;
}
