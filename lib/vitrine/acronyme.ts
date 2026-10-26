/**
 * Le nom GODAC déployé en toutes lettres. Seul endroit à modifier pour
 * changer la signification affichée sur le site (animation de l'accueil,
 * pied de page, README). Phrase officielle :
 * « Gestion et Optimisation Des Actifs et Charges ».
 *
 * `liaison` est le petit mot qui précède le mot de la lettre dans la phrase
 * (« Gestion ET Optimisation »). Pistes de remplacement possibles :
 * « … Des Activités de Conduite », « … Des Activités Connectées ».
 */
export interface LettreAcronyme {
  lettre: string;
  mot: string;
  liaison?: string;
}

export const ACRONYME: { lettres: LettreAcronyme[] } = {
  lettres: [
    { lettre: "G", mot: "Gestion" },
    { lettre: "O", mot: "Optimisation", liaison: "et" },
    { lettre: "D", mot: "Des" },
    { lettre: "A", mot: "Actifs" },
    { lettre: "C", mot: "Charges", liaison: "et" },
  ],
};

/** La phrase complète, d'après les lettres et leurs liaisons. */
export function phraseAcronyme(lettres: LettreAcronyme[] = ACRONYME.lettres): string {
  return lettres.map((l) => (l.liaison ? `${l.liaison} ${l.mot}` : l.mot)).join(" ");
}

/** Le sigle (« GODAC ») d'après les lettres. */
export function sigleAcronyme(lettres: LettreAcronyme[] = ACRONYME.lettres): string {
  return lettres.map((l) => l.lettre).join("");
}
