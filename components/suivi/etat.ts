// Couleurs des états de tournée sur la carte et dans les pastilles du suivi :
// mêmes codes partout (dans les temps teal, à surveiller orange, en retard
// rouge GODAC, hors ligne gris). Le rouge est écrit en dur (#d62718) :
// aucun jeton de thème ne porte le rouge.
import { COULEURS_CARTE } from "@/lib/colis/style-carte";
import type { EtatTournee } from "@/lib/exploitation/retards";

export const COULEUR_ETAT: Record<EtatTournee, { fond: string; texte: string }> = {
  dans_les_temps: { fond: COULEURS_CARTE.teal, texte: COULEURS_CARTE.marine },
  a_surveiller: { fond: COULEURS_CARTE.orange, texte: COULEURS_CARTE.marine },
  en_retard: { fond: "#d62718", texte: "#FFFFFF" },
  hors_ligne: { fond: "#9AA3B5", texte: COULEURS_CARTE.marine },
};
