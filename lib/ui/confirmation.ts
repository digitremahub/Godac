/**
 * Boîte de confirmation unique de GODAC (lot 3 de l'audit d'ergonomie),
 * à la place de `window.confirm` : même aspect sur tous les téléphones,
 * aux couleurs du thème choisi, accessible (focus piégé, Échap, aria).
 *
 *   if (!(await confirmer({ titre: "Supprimer ce plein ?", message: "…", action: "Supprimer", danger: true }))) return;
 *
 * Logique pure (file d'attente, options, focus) : testée dans
 * lib/ui/__tests__/confirmation.test.ts. L'affichage est fait par
 * <BoiteConfirmation>, monté une fois dans app/layout.tsx. Sans boîte
 * montée (test, page isolée), on retombe sur `window.confirm`.
 */

export interface OptionsConfirmation {
  /** Question courte, en titre (« Supprimer la tournée colis ? »). */
  titre?: string;
  /** Détail des conséquences (« C'est définitif. »). */
  message: string;
  /** Libellé du bouton qui confirme : un verbe (« Supprimer », « Retirer »). */
  action?: string;
  /** Libellé du bouton qui renonce. */
  annuler?: string;
  /** Action destructrice : bouton rouge, focus initial sur « Annuler ». */
  danger?: boolean;
}

export interface DemandeConfirmation extends Required<Omit<OptionsConfirmation, "titre">> {
  id: number;
  titre: string;
}

/** Options complétées : titre, bouton d'action et d'annulation par défaut. */
export function normaliserOptions(o: OptionsConfirmation | string, id = 0): DemandeConfirmation {
  const opts = typeof o === "string" ? { message: o } : o;
  const message = opts.message.trim();
  return {
    id,
    titre: opts.titre?.trim() || (opts.danger ? "Confirmer la suppression" : "Confirmer"),
    message,
    action: opts.action?.trim() || (opts.danger ? "Supprimer" : "Confirmer"),
    annuler: opts.annuler?.trim() || "Annuler",
    danger: opts.danger ?? false,
  };
}

type Ecouteur = () => void;

/** File des demandes : une seule boîte affichée à la fois, les suivantes attendent. */
export function creerFileConfirmation() {
  let suivant = 1;
  let file: { demande: DemandeConfirmation; resoudre: (ok: boolean) => void }[] = [];
  const ecouteurs = new Set<Ecouteur>();
  let hotes = 0;
  const prevenir = () => ecouteurs.forEach((e) => e());

  return {
    /** Demande en cours d'affichage (la première de la file), sinon null. */
    courante(): DemandeConfirmation | null {
      return file[0]?.demande ?? null;
    },
    taille(): number {
      return file.length;
    },
    demander(o: OptionsConfirmation | string): Promise<boolean> {
      return new Promise<boolean>((resoudre) => {
        file = [...file, { demande: normaliserOptions(o, suivant++), resoudre }];
        prevenir();
      });
    },
    /** Réponse à la demande `id` (ignorée si ce n'est plus la demande affichée). */
    repondre(id: number, ok: boolean): void {
      const tete = file[0];
      if (!tete || tete.demande.id !== id) return;
      file = file.slice(1);
      tete.resoudre(ok);
      prevenir();
    },
    abonner(e: Ecouteur): () => void {
      ecouteurs.add(e);
      return () => ecouteurs.delete(e);
    },
    /** Une boîte est montée pour afficher les demandes. */
    enregistrerHote(): () => void {
      hotes++;
      return () => {
        hotes--;
      };
    },
    aUnHote(): boolean {
      return hotes > 0;
    },
  };
}

export const fileConfirmation = creerFileConfirmation();

/**
 * Demande une confirmation. Renvoie `true` si la personne confirme,
 * `false` si elle annule (bouton, Échap, clic hors de la boîte).
 */
export function confirmer(o: OptionsConfirmation | string): Promise<boolean> {
  if (!fileConfirmation.aUnHote() && typeof window !== "undefined") {
    const d = normaliserOptions(o);
    return Promise.resolve(window.confirm(d.titre === "Confirmer" ? d.message : `${d.titre}\n\n${d.message}`));
  }
  return fileConfirmation.demander(o);
}

/**
 * Piège à focus : élément à focaliser après Tab (ou Maj+Tab) depuis
 * l'élément `courant` parmi `n` éléments focalisables ; on boucle aux
 * extrémités. `courant` = -1 : le focus est hors de la boîte.
 */
export function indexFocusSuivant(n: number, courant: number, arriere: boolean): number {
  if (n <= 0) return -1;
  if (courant < 0) return arriere ? n - 1 : 0;
  return arriere ? (courant - 1 + n) % n : (courant + 1) % n;
}
