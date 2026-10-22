import { cssCouleursEntreprise, type CouleursEntreprise } from "@/lib/theme/couleurs-entreprise";

/**
 * Variables CSS des couleurs de l'entreprise, posées par-dessus
 * app/globals.css pour tous les membres (tableau de bord, écrans plein
 * écran). Rien n'est injecté sans couleurs choisies : le site public et
 * les PDF gardent les couleurs GODAC. Le CSS ne contient que des nombres
 * tirés de couleurs #RRGGBB validées.
 */
export function StyleCouleursEntreprise({ couleurs }: { couleurs: CouleursEntreprise | null }) {
  if (!couleurs) return null;
  return <style id="couleurs-entreprise" dangerouslySetInnerHTML={{ __html: cssCouleursEntreprise(couleurs) }} />;
}
